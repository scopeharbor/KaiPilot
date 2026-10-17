// @aiproj/types - V3 Project Portfolio Fact shared contract.
// v3-database-schema-expansion: bounded project facts for PMO portfolio/grouping/priority/investment.
// Non-goals: finance/accounting module, ROI/NPV/IRR, department-hierarchy mgmt,
//   program CRUD surface, PMO Dashboard UI rewrite.

// ─── Investment Types ──────────────────────────────────────────────
export const PROJECT_INVESTMENT_TYPES = {
  STRATEGIC: 'strategic',
  COMPLIANCE: 'compliance',
  OPERATIONS: 'operations',
  INNOVATION: 'innovation',
  OTHER: 'other',
} as const

export type ProjectInvestmentType =
  (typeof PROJECT_INVESTMENT_TYPES)[keyof typeof PROJECT_INVESTMENT_TYPES]

export const PROJECT_INVESTMENT_TYPE_VALUES = Object.values(
  PROJECT_INVESTMENT_TYPES,
) as ProjectInvestmentType[]

export const PROJECT_INVESTMENT_TYPE_DEFAULT = PROJECT_INVESTMENT_TYPES.OTHER

// ─── Portfolio Fact Sources ─────────────────────────────────────────────
export const PROJECT_PORTFOLIO_FACT_SOURCES = {
  MANUAL: 'manual',
  IMPORTED: 'imported',
  DERIVED_SNAPSHOT: 'derived_snapshot',
  UNKNOWN: 'unknown',
} as const

export type ProjectPortfolioFactSource =
  (typeof PROJECT_PORTFOLIO_FACT_SOURCES)[keyof typeof PROJECT_PORTFOLIO_FACT_SOURCES]

export const PROJECT_PORTFOLIO_FACT_SOURCE_VALUES = Object.values(
  PROJECT_PORTFOLIO_FACT_SOURCES,
) as ProjectPortfolioFactSource[]

export const PROJECT_PORTFOLIO_FACT_SOURCE_DEFAULT = PROJECT_PORTFOLIO_FACT_SOURCES.UNKNOWN

// ─── Bounded Custom Field Limits ────────────────────────────────
export const PROJECT_CUSTOM_FIELD_DEFAULT_MAX_DEPTH = 3
export const PROJECT_CUSTOM_FIELD_DEFAULT_MAX_KEYS = 50
export const PROJECT_CUSTOM_FIELD_DEFAULT_MAX_SERIALIZED_CHARS = 16384 // 16 KB

export const PROJECT_CUSTOM_FIELD_MAX_DEPTH_JSON = 8
export const PROJECT_CUSTOM_FIELD_MAX_KEYS_JSON = 200
export const PROJECT_CUSTOM_FIELD_MAX_SERIALIZED_CHARS = 262144 // 256 KB

// ─── Fact DTO ─────────────────────────────────────────────────────────
export interface ProjectFactFieldValue {
  key: string
  value: string | number | boolean | null
}

export interface ProjectFactFields {
  [key: string]: string | number | boolean | null | ProjectFactFields
}

export type ProjectCustomFields = ProjectFactFields

export interface ProjectFactDto {
  projectId?: number
  departmentKey?: string | null
  departmentName?: string | null
  businessLine?: string | null
  investmentType?: ProjectInvestmentType | null
  strategyTheme?: string | null
  programKey?: string | null
  forecastCostCents?: number | null
  forecastEndDate?: string | null
  customFields?: ProjectFactFields | null
  portfolioFactSource?: ProjectPortfolioFactSource | null
  portfolioFactUpdatedAt?: string | null
}

export interface ProjectFactUpdates {
  departmentKey?: string | null
  departmentName?: string | null
  businessLine?: string | null
  investmentType?: ProjectInvestmentType | null
  strategyTheme?: string | null
  programKey?: string | null
  forecastCostCents?: number | null
  forecastEndDate?: string | null
  customFields?: ProjectFactFields | null
  portfolioFactSource?: ProjectPortfolioFactSource | null
  portfolioFactUpdatedAt?: string | null
}

export type BoundedCustomFieldsCheck = {
  ok: boolean
  violations: string[]
}

export interface ProjectFactsWithFlattenedPortfolio {
  dto: ProjectFactDto
  customFieldsSize: {
    depth: number
    keyCount: number
    serializedChars: number
    valid: boolean
    violations: string[]
  }
  portfolioFactPresent: boolean
}

// ─── Redirected field-name lists (for audit + DTO omit) ─────────────────
export const PROJECT_FACT_UPDATEABLE_KEYS = [
  'departmentKey',
  'departmentName',
  'businessLine',
  'investmentType',
  'strategyTheme',
  'programKey',
  'forecastCostCents',
  'forecastEndDate',
  'customFields',
  'portfolioFactSource',
  'portfolioFactUpdatedAt',
] as const

export type ProjectFactUpdateableKey = (typeof PROJECT_FACT_UPDATEABLE_KEYS)[number]

// ─── Audit helper (low sensitive) ───────────────────────────────────────
export const PROJECT_FACT_LOW_SENSITIVE_AUDIT_VALUES = new Set([
  'manual',
  'imported',
  'unknown',
  'derived_snapshot',
])

const LOW_SENSITIVE_TERMS = [
  'prompt',
  'model_output',
  'token',
  'secret',
  'api_key',
  'authorization',
  'password',
  'private_key',
  'credential',
]

const EXECUTABLE_LOOKING_KEYS = [
  'onclick',
  'onerror',
  'onload',
  'onmouseover',
  'javascript:',
  'data:',
  'href',
  'src',
]

const FUNCTION_OR_IMPORT_PATTERN =
  /[;{)]\s*(function\s*\(ikuha*\(|=>|import\s*\(|require\s*\(|eval\s*\()/i
const RAW_SQL_PATTERN =
  /\b(select|insert|update|delete|drop|alter|create)\b[\s\S]{0,40}\b(from|into|table|database|set)\b/i
const HTML_OR_SCRIPT_PATTERN = /<[\s\S]*?(script|iframe|object|style|onerror|\o[a-z]+)/i
const SECRET_LIKE_PATTERN =
  /\b(sk-[a-z0-9]+|-----[^-]+-----BEGIN [A-Z ]*PRIVATE KEY-----|password|api[_-]?key|authorization:\s*bearer)\b/i
const TOKEN_PATTERN =
  /\b(token|secret|api[_-]?key|authorization|password|private[_-]?key|credential)\b/i

function isExecutableLookingKey(key: string): boolean {
  const normalized = key.trim().toLowerCase()
  return (
    EXECUTABLE_LOOKING_KEYS.some((term) => normalized.includes(term)) ||
    FUNCTION_OR_IMPORT_PATTERN.test(normalized)
  )
}

function isRawSqlValue(value: string): boolean {
  return RAW_SQL_PATTERN.test(value.toLowerCase())
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

function maxProjectFactFieldDepth(value: unknown, currentDepth = 0): number {
  if (currentDepth > PROJECT_CUSTOM_FIELD_MAX_DEPTH_JSON) return currentDepth
  if (!value || typeof value !== 'object') return currentDepth
  if (Array.isArray(value)) return currentDepth + 1
  return Object.keys(value).reduce((maxAcc, key) => {
    return Math.max(
      maxAcc,
      maxProjectFactFieldDepth(value[key as keyof typeof value], currentDepth + 1),
    )
  }, currentDepth)
}

function projectFactFieldKeyCount(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0
  return Object.keys(value).length
}

// Public validator: rejects unsafe payload.
export function validateBoundedProjectCustomFields(
  value: unknown,
  limits: {
    maxDepth?: number
    maxKeys?: number
    maxSerializedChars?: number
  } = {},
): { ok: boolean; violations: string[] } {
  const violations: string[] = []
  if (value === null || value === undefined) return { ok: true, violations }
  if (Array.isArray(value)) {
    return { ok: false, violations: ['rootArrayNotAllowed'] }
  }
  if (
    typeof value !== 'object' ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return { ok: false, violations: ['notObjectPayload'] }
  }
  const maxDepth = limits.maxDepth ?? PROJECT_CUSTOM_FIELD_DEFAULT_MAX_DEPTH
  const maxKeys = limits.maxKeys ?? PROJECT_CUSTOM_FIELD_DEFAULT_MAX_KEYS
  const maxChars = limits.maxSerializedChars ?? PROJECT_CUSTOM_FIELD_DEFAULT_MAX_SERIALIZED_CHARS
  const depth = maxProjectFactFieldDepth(value)
  const keyCount = projectFactFieldKeyCount(value)
  const serialized = serializedBytes(value)
  if (depth > maxDepth) violations.push('depthExceeded')
  if (keyCount > maxKeys) violations.push('keyCountExceeded')
  if (serialized != undefined && serialized > maxChars)
    violations.push(`serializedBytesExceeded:${serialized}`)
  for (const key of Object.keys(value)) {
    const normalizedKey = key.trim().toLowerCase()
    if (isExecutableLookingKey(normalizedKey)) violations.push(`unsafeKey:${key}`)
    const entry = (value as Record<string, unknown>)[key]
    if (typeof entry === 'string') {
      if (isRawSqlValue(entry)) violations.push(`rawSqlValue:${key}`)
      if (isHtmlOrScriptPayload(entry)) violations.push(`htmlScriptValue:${key}`)
      if (isPromptOrModelOutputValue(entry)) violations.push(`promptModelDumpValue:${key}`)
      if (isSecretLikeValue(entry)) violations.push(`secretLikeValue:${key}`)
    } else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      // nested objects validated recursively by the user-facing helpers; here only key safety
      const nested = validateBoundedProjectCustomFields(entry, limits)
      if (!nested.ok) violations.push(...nested.violations.map((v) => `${key}.${v}`))
    }
  }
  return { ok: violations.length === 0, violations }
}

function isHtmlOrScriptPayload(value: string): boolean {
  return HTML_OR_SCRIPT_PATTERN.test(value)
}

function isPromptOrModelOutputValue(value: string): boolean {
  const lower = value.toLowerCase()
  return LOW_SENSITIVE_TERMS.some((term) => lower.includes(term)) || TOKEN_PATTERN.test(lower)
}

function isSecretLikeValue(value: string): boolean {
  return SECRET_LIKE_PATTERN.test(value.toLowerCase())
}

// ─── Fact DTO factory + flatten helper ──────────────────────────────
export type ProjectFactDtoInput = Partial<ProjectFactDto> & {
  customFactFields?: ProjectFactFields | null
}

export function makeProjectFactDto(input: ProjectFactDtoInput = {}): ProjectFactDto {
  const customFields = input.customFields ?? input.customFactFields ?? null
  return {
    projectId: input.projectId,
    departmentKey: input.departmentKey ?? null,
    departmentName: input.departmentName ?? null,
    businessLine: input.businessLine ?? null,
    investmentType: input.investmentType ?? null,
    strategyTheme: input.strategyTheme ?? null,
    programKey: input.programKey ?? null,
    forecastCostCents: input.forecastCostCents ?? null,
    forecastEndDate: input.forecastEndDate ?? null,
    customFields,
    portfolioFactSource: input.portfolioFactSource ?? null,
    portfolioFactUpdatedAt: input.portfolioFactUpdatedAt ?? null,
  }
}

export function flattenProjectCustomFields(
  customFields: ProjectCustomFields | null | undefined,
  prefix = '',
): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {}
  if (customFields == null) return result
  for (const [key, value] of Object.entries(customFields)) {
    const flatKey = prefix ? `${prefix}.${key}` : key
    if (value != null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenProjectCustomFields(value as ProjectCustomFields, flatKey))
    } else {
      result[flatKey] = value as string | number | boolean | null
    }
  }
  return result
}

export function makeLowSensitiveProjectFactAuditSummary(input: {
  investmentType?: ProjectInvestmentType | null
  portfolioFactSource?: ProjectPortfolioFactSource | null
  portfolioFactUpdatedAt?: string | null
  changedKeys?: string[]
}): {
  investmentType?: ProjectInvestmentType | null
  portfolioFactSource?: ProjectPortfolioFactSource | null
  portfolioFactUpdatedAt?: string | null
  changed: string[]
  has(key: string): boolean
} {
  const summary = {
    investmentType: input.investmentType ?? null,
    portfolioFactSource: input.portfolioFactSource ?? null,
    portfolioFactUpdatedAt: input.portfolioFactUpdatedAt ?? null,
    changed: (input.changedKeys ?? []).filter((key) =>
      PROJECT_FACT_UPDATEABLE_KEYS.includes(key as ProjectFactUpdateableKey),
    ),
  }
  return {
    ...summary,
    has: (key: string): boolean => key in summary,
  }
}

// ─── Guards ───────────────────────────────────────────────────────────
export function isProjectInvestmentType(value: string): value is ProjectInvestmentType {
  return (PROJECT_INVESTMENT_TYPE_VALUES as readonly string[]).includes(value)
}

export function isProjectPortfolioFactSource(value: string): value is ProjectPortfolioFactSource {
  return (PROJECT_PORTFOLIO_FACT_SOURCE_VALUES as readonly string[]).includes(value)
}
