/**
 * v3-service-architecture-expansion — V3 backend service architecture catalog.
 *
 * Registers current high-risk service modules inside the AdonisJS monolith with
 * explicit owner, role, tenant mode, side-effect class, external action class,
 * audit/ledger expectation and evidence freshness.
 *
 * This catalog is a governance/planning surface — it does NOT change runtime
 * imports, DI, or existing domain behavior. It is consumed by the inventory
 * checker and architecture boundary checks.
 *
 * Non-goals: microservice split, service mesh, containerization, Kafka/VectorDB/
 * forced Redis, PostgreSQL cutover, /api/v2|/api/v3 migration, framework
 * replacement, external provider smoke, AI auto-execution.
 */
import {
  SERVICE_ROLES,
  TENANT_MODES,
  SIDE_EFFECT_CLASSES,
  EXTERNAL_ACTION_CLASSES,
  AUDIT_LEDGER_EXPECTATIONS,
  EVIDENCE_FRESHNESS_STATUSES,
  INFRASTRUCTURE_PREREQUISITES,
  type ServiceCatalogEntry,
} from '@aiproj/types'

/**
 * The full V3 service architecture catalog. Each entry classifies a service
 * module inside apps/backend/app/services/.
 *
 * Evidence freshness: 'fresh' = direct source listing confirms the folder
 * exists and graph agrees; 'needs-source-verification' = graph may be stale
 * (see observation-and-inventory.md §1.2); 'stale' = legacy/deferred.
 */
export const SERVICE_ARCHITECTURE_CATALOG: readonly ServiceCatalogEntry[] = [
  // ── AI domain ──────────────────────────────────────────────────────
  {
    moduleKey: 'ai-draft',
    pathScope: 'apps/backend/app/services/ai_draft/**',
    role: SERVICE_ROLES.ORCHESTRATOR_SERVICE,
    ownerDomain: 'ai',
    dependencyPolicy: {
      allowedConsumers: ['projects-controller', 'ai-intent'],
      allowedDependencies: ['ai-intent', 'ai-m0', 'knowledge', 'adapters'],
      forbiddenDependencies: ['sso', 'scim', 'kms', 'compiler'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.AI_PERSISTENCE,
    externalActionClass: EXTERNAL_ACTION_CLASSES.MODEL_CALL,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
    verificationHints: ['node ace test --suite=unit --files=ai_draft*'],
  },
  {
    moduleKey: 'ai-intent',
    pathScope: 'apps/backend/app/services/ai_intent/**',
    role: SERVICE_ROLES.DOMAIN_SERVICE,
    ownerDomain: 'ai',
    dependencyPolicy: {
      allowedConsumers: ['ai-draft'],
      allowedDependencies: [],
      forbiddenDependencies: ['sso', 'scim', 'kms'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.READ_ONLY,
    externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.NOT_REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  },
  {
    moduleKey: 'ai-m0',
    pathScope: 'apps/backend/app/services/ai_m0/**',
    role: SERVICE_ROLES.DOMAIN_SERVICE,
    ownerDomain: 'ai',
    dependencyPolicy: {
      allowedConsumers: ['ai-draft'],
      allowedDependencies: [],
      forbiddenDependencies: ['sso', 'scim'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.READ_ONLY,
    externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.NOT_REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  },
  {
    moduleKey: 'ai-ocr',
    pathScope: 'apps/backend/app/services/ai_ocr/**',
    role: SERVICE_ROLES.ORCHESTRATOR_SERVICE,
    ownerDomain: 'ai',
    dependencyPolicy: {
      allowedConsumers: ['files-controller', 'documents-controller'],
      allowedDependencies: ['adapters', 'kms', 'search'],
      forbiddenDependencies: ['sso', 'scim', 'compiler'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.PROTECTED_EVIDENCE_PACKAGE,
    externalActionClass: EXTERNAL_ACTION_CLASSES.OCR_PROVIDER_CALL,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  },

  // ── AI quality cost console ───────────────────────────────────────
  {
    moduleKey: 'ai-quality-cost-console',
    pathScope: 'apps/backend/app/services/ai_quality_cost_console/**',
    role: SERVICE_ROLES.ORCHESTRATOR_SERVICE,
    ownerDomain: 'ai',
    dependencyPolicy: {
      allowedConsumers: ['ai-quality-cost-console-controller'],
      allowedDependencies: ['rbac', 'unified-ai-invocation-ledger', 'quality-ledger'],
      forbiddenDependencies: ['sso', 'scim', 'kms', 'ai-draft'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.READ_ONLY,
    externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.NOT_REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
    verificationHints: [
      'pnpm --filter backend exec vitest run tests/unit/ai_quality_cost_console_*.spec.ts',
    ],
  },

  // ── Compiler domain ───────────────────────────────────────────────
  {
    moduleKey: 'compiler',
    pathScope: 'apps/backend/app/services/compiler/**',
    role: SERVICE_ROLES.ORCHESTRATOR_SERVICE,
    ownerDomain: 'compiler',
    dependencyPolicy: {
      allowedConsumers: ['projects-controller'],
      allowedDependencies: ['knowledge', 'search'],
      forbiddenDependencies: ['sso', 'scim', 'kms'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.FORMAL_WRITE,
    externalActionClass: EXTERNAL_ACTION_CLASSES.MODEL_CALL,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  },

  // ── Multitenant domain ────────────────────────────────────────────
  {
    moduleKey: 'multitenant-console',
    pathScope: 'apps/backend/app/services/multitenant_console/**',
    role: SERVICE_ROLES.ORCHESTRATOR_SERVICE,
    ownerDomain: 'multitenant',
    dependencyPolicy: {
      allowedConsumers: ['multitenant-controller'],
      allowedDependencies: [],
      forbiddenDependencies: ['sso', 'scim', 'kms', 'compiler', 'ai-draft'],
    },
    tenantMode: TENANT_MODES.GLOBAL_ONLY,
    sideEffectClass: SIDE_EFFECT_CLASSES.READ_ONLY,
    externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  },

  // ── Security: SSO ─────────────────────────────────────────────────
  {
    moduleKey: 'sso-saml2',
    pathScope: 'apps/backend/app/services/sso/sso_saml_*.ts',
    role: SERVICE_ROLES.DOMAIN_SERVICE,
    ownerDomain: 'security',
    dependencyPolicy: {
      allowedConsumers: ['auth-controller'],
      allowedDependencies: [],
      forbiddenDependencies: ['adapters', 'compiler', 'ai-draft', 'scim'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.IDENTITY_PROVISIONING,
    externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  },
  {
    moduleKey: 'sso-oidc',
    pathScope: 'apps/backend/app/services/sso/sso_oidc_*.ts',
    role: SERVICE_ROLES.DOMAIN_SERVICE,
    ownerDomain: 'security',
    dependencyPolicy: {
      allowedConsumers: ['auth-controller'],
      allowedDependencies: [],
      forbiddenDependencies: ['adapters', 'compiler', 'ai-draft', 'scim'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.IDENTITY_PROVISIONING,
    externalActionClass: EXTERNAL_ACTION_CLASSES.OAUTH_EXCHANGE,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.NEEDS_SOURCE_VERIFICATION,
  },

  // ── Security: SCIM ────────────────────────────────────────────────
  {
    moduleKey: 'scim',
    pathScope: 'apps/backend/app/services/scim/**',
    role: SERVICE_ROLES.DOMAIN_SERVICE,
    ownerDomain: 'security',
    dependencyPolicy: {
      allowedConsumers: ['scim-controller'],
      allowedDependencies: [],
      forbiddenDependencies: ['adapters', 'compiler', 'ai-draft', 'sso'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.IDENTITY_PROVISIONING,
    externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  },

  // ── Security: KMS / DLP / Compliance ──────────────────────────────
  {
    moduleKey: 'kms',
    pathScope: 'apps/backend/app/services/kms/**',
    role: SERVICE_ROLES.PROVIDER_SERVICE,
    ownerDomain: 'security',
    dependencyPolicy: {
      allowedConsumers: ['compliance', 'adapters', 'ai-ocr'],
      allowedDependencies: [],
      forbiddenDependencies: ['sso', 'scim', 'compiler', 'ai-draft'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.PROTECTED_EVIDENCE_PACKAGE,
    externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  },
  {
    moduleKey: 'compliance',
    pathScope: 'apps/backend/app/services/compliance/**',
    role: SERVICE_ROLES.DOMAIN_SERVICE,
    ownerDomain: 'security',
    dependencyPolicy: {
      allowedConsumers: ['compliance-controller'],
      allowedDependencies: ['kms'],
      forbiddenDependencies: ['sso', 'scim', 'compiler', 'ai-draft'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.EXPORT,
    externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  },
  {
    moduleKey: 'security',
    pathScope: 'apps/backend/app/services/security/**',
    role: SERVICE_ROLES.POLICY_HELPER,
    ownerDomain: 'security',
    dependencyPolicy: {
      allowedConsumers: ['webhooks', 'sso', 'scim'],
      allowedDependencies: [],
      forbiddenDependencies: ['compiler', 'ai-draft'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.READ_ONLY,
    externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.NOT_REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  },

  // ── Adapters (authority-free boundary) ────────────────────────────
  {
    moduleKey: 'adapters',
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
  },

  // ── BI / Reporting ────────────────────────────────────────────────
  {
    moduleKey: 'bi-aggregation',
    pathScope: 'apps/backend/app/services/bi_aggregation/**',
    role: SERVICE_ROLES.DOMAIN_SERVICE,
    ownerDomain: 'bi',
    dependencyPolicy: {
      allowedConsumers: ['bi-controller'],
      allowedDependencies: [],
      forbiddenDependencies: ['sso', 'scim', 'kms'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.READ_ONLY,
    externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.NOT_REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  },
  {
    moduleKey: 'bi-custom-report',
    pathScope: 'apps/backend/app/services/bi_custom_report/**',
    role: SERVICE_ROLES.DOMAIN_SERVICE,
    ownerDomain: 'bi',
    dependencyPolicy: {
      allowedConsumers: ['bi-controller'],
      allowedDependencies: ['bi-aggregation'],
      forbiddenDependencies: ['sso', 'scim', 'kms'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.READ_ONLY,
    externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.NOT_REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  },
  {
    moduleKey: 'bi-dashboard',
    pathScope: 'apps/backend/app/services/bi_dashboard/**',
    role: SERVICE_ROLES.DOMAIN_SERVICE,
    ownerDomain: 'bi',
    dependencyPolicy: {
      allowedConsumers: ['bi-controller'],
      allowedDependencies: ['bi-aggregation'],
      forbiddenDependencies: ['sso', 'scim', 'kms'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.READ_ONLY,
    externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.NOT_REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  },
  {
    moduleKey: 'bi-report-templates',
    pathScope: 'apps/backend/app/services/bi_report_templates/**',
    role: SERVICE_ROLES.DOMAIN_SERVICE,
    ownerDomain: 'bi',
    dependencyPolicy: {
      allowedConsumers: ['bi-controller'],
      allowedDependencies: [],
      forbiddenDependencies: ['sso', 'scim', 'kms'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.READ_ONLY,
    externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.NOT_REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  },
  {
    moduleKey: 'report-v2',
    pathScope: 'apps/backend/app/services/report_v2/**',
    role: SERVICE_ROLES.DOMAIN_SERVICE,
    ownerDomain: 'bi',
    dependencyPolicy: {
      allowedConsumers: ['reports-controller'],
      allowedDependencies: ['adapters'],
      forbiddenDependencies: ['sso', 'scim', 'kms'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.EXPORT,
    externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  },

  // ── TRIZ domain (8 sub-folders) ───────────────────────────────────
  {
    moduleKey: 'triz-clarification',
    pathScope: 'apps/backend/app/services/triz_clarification/**',
    role: SERVICE_ROLES.DOMAIN_SERVICE,
    ownerDomain: 'triz',
    dependencyPolicy: {
      allowedConsumers: ['triz-controller'],
      allowedDependencies: [],
      forbiddenDependencies: ['sso', 'scim', 'kms'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.READ_ONLY,
    externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.NOT_REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  },
  {
    moduleKey: 'triz-compiler',
    pathScope: 'apps/backend/app/services/triz_compiler/**',
    role: SERVICE_ROLES.DOMAIN_SERVICE,
    ownerDomain: 'triz',
    dependencyPolicy: {
      allowedConsumers: ['triz-controller'],
      allowedDependencies: ['compiler'],
      forbiddenDependencies: ['sso', 'scim', 'kms'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.READ_ONLY,
    externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.NOT_REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  },
  {
    moduleKey: 'triz-contradiction',
    pathScope: 'apps/backend/app/services/triz_contradiction/**',
    role: SERVICE_ROLES.DOMAIN_SERVICE,
    ownerDomain: 'triz',
    dependencyPolicy: {
      allowedConsumers: ['triz-controller'],
      allowedDependencies: [],
      forbiddenDependencies: ['sso', 'scim', 'kms'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.READ_ONLY,
    externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.NOT_REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  },
  {
    moduleKey: 'triz-decision',
    pathScope: 'apps/backend/app/services/triz_decision/**',
    role: SERVICE_ROLES.DOMAIN_SERVICE,
    ownerDomain: 'triz',
    dependencyPolicy: {
      allowedConsumers: ['triz-controller'],
      allowedDependencies: [],
      forbiddenDependencies: ['sso', 'scim', 'kms'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.READ_ONLY,
    externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.NOT_REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  },
  {
    moduleKey: 'triz-innovation',
    pathScope: 'apps/backend/app/services/triz_innovation/**',
    role: SERVICE_ROLES.DOMAIN_SERVICE,
    ownerDomain: 'triz',
    dependencyPolicy: {
      allowedConsumers: ['triz-controller'],
      allowedDependencies: [],
      forbiddenDependencies: ['sso', 'scim', 'kms'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.READ_ONLY,
    externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.NOT_REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  },
  {
    moduleKey: 'triz-other',
    pathScope: 'apps/backend/app/services/triz_{ifr,rationale,skill_layer}/**',
    role: SERVICE_ROLES.DOMAIN_SERVICE,
    ownerDomain: 'triz',
    dependencyPolicy: {
      allowedConsumers: ['triz-controller'],
      allowedDependencies: [],
      forbiddenDependencies: ['sso', 'scim', 'kms'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.READ_ONLY,
    externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.NOT_REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  },

  // ── Webhooks / Realtime / Streaming ───────────────────────────────
  {
    moduleKey: 'webhooks',
    pathScope: 'apps/backend/app/services/webhooks/**',
    role: SERVICE_ROLES.DOMAIN_SERVICE,
    ownerDomain: 'integration',
    dependencyPolicy: {
      allowedConsumers: ['webhooks-controller'],
      allowedDependencies: ['security'],
      forbiddenDependencies: ['sso', 'scim', 'kms', 'compiler', 'ai-draft'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.EXTERNAL_WRITE,
    externalActionClass: EXTERNAL_ACTION_CLASSES.WEBHOOK_DELIVERY,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  },
  {
    moduleKey: 'realtime',
    pathScope: 'apps/backend/app/services/realtime/**',
    role: SERVICE_ROLES.DOMAIN_SERVICE,
    ownerDomain: 'integration',
    dependencyPolicy: {
      allowedConsumers: ['ai-draft', 'compiler', 'tasks-controller'],
      allowedDependencies: [],
      forbiddenDependencies: ['sso', 'scim', 'kms'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.NONE,
    externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.NOT_REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  },
  {
    moduleKey: 'streaming',
    pathScope: 'apps/backend/app/services/streaming/**',
    role: SERVICE_ROLES.DOMAIN_SERVICE,
    ownerDomain: 'integration',
    dependencyPolicy: {
      allowedConsumers: ['ai-draft', 'compiler'],
      allowedDependencies: [],
      forbiddenDependencies: ['sso', 'scim', 'kms'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.NONE,
    externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.NOT_REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  },

  // ── Knowledge ─────────────────────────────────────────────────────
  {
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
  },

  // ── v3-document-intelligence-workbench —— 项目级文档智能工作台（只读聚合 read model）──
  {
    moduleKey: 'document-intelligence',
    pathScope: 'apps/backend/app/services/document_intelligence/**',
    role: SERVICE_ROLES.DOMAIN_SERVICE,
    ownerDomain: 'documents',
    dependencyPolicy: {
      // 只被自身 Controller 消费；只依赖既有文件/OCR 只读查询与治理 resolver，
      // 且依赖端口封闭为纯读（owning command 由类型与测试双重拒绝注入）。
      allowedConsumers: ['document-intelligence-controller'],
      allowedDependencies: ['ai-ocr', 'documents', 'files'],
      forbiddenDependencies: ['sso', 'scim', 'kms', 'ai-draft'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.READ_ONLY,
    externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.NOT_REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  },

  // ── v3-knowledge-memory-operating-layer —— 组织级知识与记忆运营层（只读 read model）──
  {
    moduleKey: 'knowledge-memory-operating',
    pathScope: 'apps/backend/app/services/knowledge_memory_operating/**',
    role: SERVICE_ROLES.DOMAIN_SERVICE,
    ownerDomain: 'knowledge',
    dependencyPolicy: {
      allowedConsumers: ['knowledge-memory-operating-controller'],
      allowedDependencies: ['knowledge', 'compiler'],
      forbiddenDependencies: ['sso', 'scim', 'kms', 'ai-draft'],
    },
    tenantMode: TENANT_MODES.TENANT_BOUND,
    sideEffectClass: SIDE_EFFECT_CLASSES.READ_ONLY,
    externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
    auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.NOT_REQUIRED,
    fixtureFirstTestStatus: true,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  },

  // ── Legacy / Deferred entries (task 3.3) ──────────────────────────
  {
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
    verificationHints: [
      'legacy: not yet fully governed; follow-up change needed to classify or remove',
    ],
  },
  {
    moduleKey: 'pdm-migration-deferred',
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
    verificationHints: ['deferred: PDM migration is historical; not active V3 work'],
  },
] as const

/**
 * Load the service architecture catalog as a mutable array (for testing).
 */
export function loadServiceArchitectureCatalog(): ServiceCatalogEntry[] {
  return SERVICE_ARCHITECTURE_CATALOG.map((entry) => ({ ...entry }))
}

/**
 * Look up a catalog entry by module key.
 */
export function findCatalogEntry(moduleKey: string): ServiceCatalogEntry | undefined {
  return SERVICE_ARCHITECTURE_CATALOG.find((e) => e.moduleKey === moduleKey)
}

/**
 * Get all registered (non-legacy) module keys.
 */
export function getRegisteredModuleKeys(): string[] {
  return SERVICE_ARCHITECTURE_CATALOG.filter((e) => e.role !== SERVICE_ROLES.LEGACY_SERVICE).map(
    (e) => e.moduleKey,
  )
}

/**
 * Get all legacy module keys.
 */
export function getLegacyModuleKeys(): string[] {
  return SERVICE_ARCHITECTURE_CATALOG.filter((e) => e.role === SERVICE_ROLES.LEGACY_SERVICE).map(
    (e) => e.moduleKey,
  )
}

// Re-export infrastructure prerequisite for convenience.
export { INFRASTRUCTURE_PREREQUISITES }
