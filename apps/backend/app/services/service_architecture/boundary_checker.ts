/**
 * v3-service-architecture-expansion — architecture boundary checker.
 *
 * Focused checks for AdonisJS five-layer boundaries:
 * - Controller: flags business logic, provider calls, tenant decisions, orchestration
 * - Service: flags raw HTTP request/response/cookie/header authority usage
 * - Validator/Policy: flags database writes, provider calls, domain mutations
 * - Adapter/Provider: flags HTTP context reads, RBAC decisions, tenant authority,
 *   formal domain writes, sensitive payload persistence
 * - Audit/Ledger: flags sensitive payloads (prompt, model output, token, etc.)
 *
 * Uses lightweight text/regex pattern matching over file content.
 * Supports narrow allowlists with required reason/owner/expiry.
 *
 * Task 4.1-4.6.
 */
import {
  BOUNDARY_CHECK_CATEGORIES,
  ARCHITECTURE_REASON_CODES,
  FINDING_SEVERITIES,
  EVIDENCE_FRESHNESS_STATUSES,
  SENSITIVE_PAYLOAD_KEYWORDS,
  type ServiceArchitectureFinding,
  type AllowlistEntry,
  type BoundaryCheckCategory,
  validateAllowlistEntry,
} from '@aiproj/types'

export interface BoundaryCheckResult {
  findings: ServiceArchitectureFinding[]
  /** Findings suppressed by allowlist entries. */
  suppressed: ServiceArchitectureFinding[]
}

export interface BoundaryCheckOptions {
  /** Allowlist entries that can suppress findings for specific categories/patterns. */
  allowlist?: AllowlistEntry[]
  /** Module key for the file being checked. */
  moduleKey: string
}

// ─── Pattern definitions ────────────────────────────────────────────

/** Patterns that indicate controller business logic (task 4.1).
 * Uses negative lookbehinds to exclude service/validator delegations. */
const CONTROLLER_BUSINESS_LOGIC_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  // Flag .save/.create/.update/.delete only when NOT preceded by service. (delegation).
  { pattern: /(?<!service)\.save\s*\(/, message: 'controller performs domain write (save)' },
  { pattern: /(?<!service)\.create\s*\(/, message: 'controller performs domain write (create)' },
  { pattern: /(?<!service)\.update\s*\(/, message: 'controller performs domain write (update)' },
  { pattern: /(?<!service)\.delete\s*\(/, message: 'controller performs domain write (delete)' },
  {
    pattern: /Database\.|db\.from\(|db\.insert\(/,
    message: 'controller performs direct database access',
  },
  { pattern: /adapter\.|provider\./, message: 'controller calls external provider/adapter' },
  {
    pattern: /tenantId\s*=|organizationId\s*=/,
    message: 'controller makes tenant ownership decision',
  },
  {
    pattern: /if\s*\([^)]*\)\s*\{[^}]*service\./,
    message: 'controller performs multi-step orchestration',
  },
]

/** Patterns that indicate service HTTP authority usage (task 4.2). */
const SERVICE_HTTP_AUTHORITY_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /ctx\.request\b|request\.body\b|request\.input\b/,
    message: 'service reads raw HTTP request body',
  },
  { pattern: /request\.header\b|request\.headers\b/, message: 'service reads raw HTTP headers' },
  { pattern: /request\.cookie\b|request\.cookies\b/, message: 'service reads raw HTTP cookies' },
  {
    pattern: /ctx\.response\b|response\.status\b|response\.send\b/,
    message: 'service writes raw HTTP response',
  },
  { pattern: /HttpContext/, message: 'service imports HttpContext' },
]

/** Patterns that indicate validator/policy side effects (task 4.3). */
const VALIDATOR_POLICY_SIDE_EFFECT_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /Database\.|db\.from\(|db\.insert\(|db\.update\(/,
    message: 'validator/policy performs database write',
  },
  {
    pattern:
      /(?<!service)\.save\s*\(|(?<!service)\.create\s*\(|(?<!service)\.update\s*\(|(?<!service)\.delete\s*\(/,
    message: 'validator/policy performs domain mutation',
  },
  { pattern: /adapter\.|provider\./, message: 'validator/policy calls external provider' },
]

/** Patterns that indicate adapter/provider authority smell (task 4.4). */
const ADAPTER_AUTHORITY_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /ctx\.request\b|request\.body\b|request\.header\b/,
    message: 'adapter reads HTTP context',
  },
  { pattern: /HttpContext/, message: 'adapter imports HttpContext' },
  {
    pattern: /RbacService|rbac\.check|policy\.authorize/,
    message: 'adapter performs RBAC decision',
  },
  { pattern: /tenantId\s*=|organizationId\s*=/, message: 'adapter derives tenant authority' },
  {
    pattern: /\.save\s*\(|\.create\s*\(|\.update\s*\(|\.delete\s*\(/,
    message: 'adapter writes formal domain data',
  },
  {
    pattern: /console\.log\(.*prompt|console\.log\(.*token|console\.log\(.*apiKey/,
    message: 'adapter logs sensitive payload',
  },
]

/** Patterns that indicate sensitive audit/ledger payload (task 4.5). */
const AUDIT_LEDGER_SENSITIVE_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /prompt\s*[:=]/i, message: 'audit/ledger stores prompt text' },
  {
    pattern: /modelOutput\s*[:=]|model_output\s*[:=]/i,
    message: 'audit/ledger stores model output',
  },
  {
    pattern: /rawProviderPayload\s*[:=]|raw_provider_payload\s*[:=]/i,
    message: 'audit/ledger stores raw provider payload',
  },
  { pattern: /token\s*[:=]/i, message: 'audit/ledger stores token' },
  { pattern: /apiKey\s*[:=]|api_key\s*[:=]/i, message: 'audit/ledger stores API key' },
  { pattern: /authorization\s*[:=]/i, message: 'audit/ledger stores Authorization header' },
  { pattern: /rawXml\s*[:=]|raw_xml\s*[:=]/i, message: 'audit/ledger stores raw XML assertion' },
  {
    pattern: /crossTenantDetail\s*[:=]|cross_tenant_detail\s*[:=]/i,
    message: 'audit/ledger stores hidden cross-tenant detail',
  },
  {
    pattern: /documentBody\s*[:=]|document_body\s*[:=]/i,
    message: 'audit/ledger stores sensitive document body',
  },
]

// ─── Check functions ────────────────────────────────────────────────

/**
 * Check controller file content for business logic boundary violations (task 4.1).
 */
export function checkControllerBoundary(
  content: string,
  filePath: string,
  options: BoundaryCheckOptions,
): ServiceArchitectureFinding[] {
  const findings: ServiceArchitectureFinding[] = []
  for (const { pattern, message } of CONTROLLER_BUSINESS_LOGIC_PATTERNS) {
    if (pattern.test(content)) {
      findings.push({
        moduleKey: options.moduleKey,
        filePath,
        category: BOUNDARY_CHECK_CATEGORIES.CONTROLLER,
        reasonCode: ARCHITECTURE_REASON_CODES.CONTROLLER_BUSINESS_LOGIC,
        severity: FINDING_SEVERITIES.MEDIUM,
        message,
        evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
      })
    }
  }
  return applyAllowlist(findings, options.allowlist ?? [])
}

/**
 * Check service file content for HTTP authority usage (task 4.2).
 */
export function checkServiceBoundary(
  content: string,
  filePath: string,
  options: BoundaryCheckOptions,
): ServiceArchitectureFinding[] {
  const findings: ServiceArchitectureFinding[] = []
  for (const { pattern, message } of SERVICE_HTTP_AUTHORITY_PATTERNS) {
    if (pattern.test(content)) {
      findings.push({
        moduleKey: options.moduleKey,
        filePath,
        category: BOUNDARY_CHECK_CATEGORIES.SERVICE,
        reasonCode: ARCHITECTURE_REASON_CODES.SERVICE_HTTP_AUTHORITY,
        severity: FINDING_SEVERITIES.MEDIUM,
        message,
        evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
      })
    }
  }
  return applyAllowlist(findings, options.allowlist ?? [])
}

/**
 * Check validator/policy file content for side effects (task 4.3).
 */
export function checkValidatorPolicyBoundary(
  content: string,
  filePath: string,
  options: BoundaryCheckOptions,
): ServiceArchitectureFinding[] {
  const findings: ServiceArchitectureFinding[] = []
  for (const { pattern, message } of VALIDATOR_POLICY_SIDE_EFFECT_PATTERNS) {
    if (pattern.test(content)) {
      findings.push({
        moduleKey: options.moduleKey,
        filePath,
        category: BOUNDARY_CHECK_CATEGORIES.VALIDATOR,
        reasonCode: ARCHITECTURE_REASON_CODES.VALIDATOR_POLICY_SIDE_EFFECT,
        severity: FINDING_SEVERITIES.HIGH,
        message,
        evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
      })
    }
  }
  return applyAllowlist(findings, options.allowlist ?? [])
}

/**
 * Check adapter/provider file content for authority smell (task 4.4).
 */
export function checkAdapterProviderBoundary(
  content: string,
  filePath: string,
  options: BoundaryCheckOptions,
): ServiceArchitectureFinding[] {
  const findings: ServiceArchitectureFinding[] = []
  for (const { pattern, message } of ADAPTER_AUTHORITY_PATTERNS) {
    if (pattern.test(content)) {
      findings.push({
        moduleKey: options.moduleKey,
        filePath,
        category: BOUNDARY_CHECK_CATEGORIES.ADAPTER_PROVIDER,
        reasonCode: ARCHITECTURE_REASON_CODES.ADAPTER_AUTHORITY_SMELL,
        severity: FINDING_SEVERITIES.HIGH,
        message,
        evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
      })
    }
  }
  return applyAllowlist(findings, options.allowlist ?? [])
}

/**
 * Check audit/ledger fixture content for sensitive payloads (task 4.5).
 */
export function checkAuditLedgerBoundary(
  content: string,
  filePath: string,
  options: BoundaryCheckOptions,
): ServiceArchitectureFinding[] {
  const findings: ServiceArchitectureFinding[] = []
  for (const { pattern, message } of AUDIT_LEDGER_SENSITIVE_PATTERNS) {
    if (pattern.test(content)) {
      findings.push({
        moduleKey: options.moduleKey,
        filePath,
        category: BOUNDARY_CHECK_CATEGORIES.AUDIT_LEDGER,
        reasonCode: ARCHITECTURE_REASON_CODES.SENSITIVE_AUDIT_PAYLOAD,
        severity: FINDING_SEVERITIES.HIGH,
        message,
        evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
      })
    }
  }
  // Also check using the shared sensitive keyword scan.
  const normalized = content.toLowerCase().replace(/_/g, '-')
  for (const kw of SENSITIVE_PAYLOAD_KEYWORDS) {
    const normalizedKw = kw.replace(/_/g, '-')
    if (normalized.includes(normalizedKw)) {
      const alreadyFound = findings.some((f) => f.message.includes(kw))
      if (!alreadyFound) {
        findings.push({
          moduleKey: options.moduleKey,
          filePath,
          category: BOUNDARY_CHECK_CATEGORIES.AUDIT_LEDGER,
          reasonCode: ARCHITECTURE_REASON_CODES.SENSITIVE_AUDIT_PAYLOAD,
          severity: FINDING_SEVERITIES.HIGH,
          message: 'audit/ledger contains sensitive keyword: ' + kw,
          evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
        })
      }
    }
  }
  return applyAllowlist(findings, options.allowlist ?? [])
}

// ─── Allowlist support (task 4.6) ───────────────────────────────────

/**
 * Apply allowlist suppression to findings.
 * Findings whose category matches a valid allowlist entry are suppressed.
 */
export function applyAllowlist(
  findings: ServiceArchitectureFinding[],
  allowlist: AllowlistEntry[],
): ServiceArchitectureFinding[] {
  const validEntries = allowlist.filter((al) => validateAllowlistEntry(al).ok)
  if (validEntries.length === 0) return findings
  return findings.filter((f) => {
    return !validEntries.some((al) => al.category === f.category)
  })
}

/**
 * Validate that all allowlist entries have required reason/owner/expiry.
 * Returns invalid entries for reporting.
 */
export function validateAllowlistEntries(
  allowlist: AllowlistEntry[],
): Array<{ entry: AllowlistEntry; errors: string[] }> {
  const invalid: Array<{ entry: AllowlistEntry; errors: string[] }> = []
  for (const entry of allowlist) {
    const result = validateAllowlistEntry(entry)
    if (!result.ok) {
      invalid.push({
        entry,
        errors: result.errors.map((e) => e.message),
      })
    }
  }
  return invalid
}

/**
 * Run all boundary checks on a file and return combined findings.
 */
export function checkAllBoundaries(
  content: string,
  filePath: string,
  options: BoundaryCheckOptions,
): BoundaryCheckResult {
  const allFindings: ServiceArchitectureFinding[] = [
    ...checkControllerBoundary(content, filePath, options),
    ...checkServiceBoundary(content, filePath, options),
    ...checkValidatorPolicyBoundary(content, filePath, options),
    ...checkAdapterProviderBoundary(content, filePath, options),
    ...checkAuditLedgerBoundary(content, filePath, options),
  ]
  return { findings: allFindings, suppressed: [] }
}

export type { ServiceArchitectureFinding, AllowlistEntry, BoundaryCheckCategory }
