/**
 * v3-plugin-private-registry-lifecycle — PluginRegistry Validator（tasks 7.1–7.2）。
 *
 * 稳定 request/response DTO 映射：验证分页/过滤/semantic range/action/reason code/handle 格式。
 * 不在 Validator 查库或接受 authority 字段。
 *
 * 红线：Validator 只做格式/枚举/长度校验，不做业务判断。
 */

import {
  REGISTRY_COMMAND_ACTIONS,
  REGISTRY_RELEASE_STATUSES,
  REGISTRY_ERROR_CODES,
  isValidSemver,
} from '@aiproj/types'

// =============================================================================
// Validation Result
// =============================================================================

export interface ValidationResult {
  readonly valid: boolean
  readonly errors: readonly ValidationError[]
}

export interface ValidationError {
  readonly field: string
  readonly code: string
  readonly message: string
}

function ok(): ValidationResult {
  return { valid: true, errors: [] }
}

function fail(errors: ValidationError[]): ValidationResult {
  return { valid: false, errors }
}

// =============================================================================
// Validators
// =============================================================================

/**
 * Validate pagination parameters.
 */
export function validatePagination(params: {
  page?: unknown
  perPage?: unknown
}): ValidationResult {
  const errors: ValidationError[] = []

  if (params.page !== undefined) {
    const page = Number(params.page)
    if (!Number.isInteger(page) || page < 1) {
      errors.push({
        field: 'page',
        code: 'invalid-value',
        message: 'page must be a positive integer',
      })
    }
  }

  if (params.perPage !== undefined) {
    const perPage = Number(params.perPage)
    if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100) {
      errors.push({
        field: 'perPage',
        code: 'invalid-value',
        message: 'perPage must be between 1 and 100',
      })
    }
  }

  return errors.length === 0 ? ok() : fail(errors)
}

/**
 * Validate sort parameter.
 */
export function validateSort(sort: unknown): ValidationResult {
  if (sort === undefined || sort === null) return ok()

  const validSorts = [
    '-createdAt',
    '+createdAt',
    '-version',
    '+version',
    '-updatedAt',
    '+updatedAt',
  ]
  if (typeof sort !== 'string' || !validSorts.includes(sort)) {
    return fail([
      {
        field: 'sort',
        code: 'invalid-value',
        message: `sort must be one of: ${validSorts.join(', ')}`,
      },
    ])
  }

  return ok()
}

/**
 * Validate status filter.
 */
export function validateStatusFilter(status: unknown): ValidationResult {
  if (status === undefined || status === null) return ok()

  if (
    typeof status !== 'string' ||
    !(REGISTRY_RELEASE_STATUSES as readonly string[]).includes(status)
  ) {
    return fail([
      {
        field: 'status',
        code: 'invalid-value',
        message: `status must be one of: ${REGISTRY_RELEASE_STATUSES.join(', ')}`,
      },
    ])
  }

  return ok()
}

/**
 * Validate semantic version.
 */
export function validateVersion(version: unknown): ValidationResult {
  if (typeof version !== 'string') {
    return fail([{ field: 'version', code: 'invalid-type', message: 'version must be a string' }])
  }

  if (!isValidSemver(version)) {
    return fail([
      {
        field: 'version',
        code: 'invalid-format',
        message: 'version must be valid semver (MAJOR.MINOR.PATCH)',
      },
    ])
  }

  return ok()
}

/**
 * Validate semantic version range.
 */
export function validateVersionRange(range: unknown): ValidationResult {
  if (range === undefined || range === null) return ok()

  if (typeof range !== 'string') {
    return fail([{ field: 'range', code: 'invalid-type', message: 'range must be a string' }])
  }

  // Allow exact version or >= prefix
  if (range.startsWith('>=')) {
    const minVersion = range.slice(2)
    if (!isValidSemver(minVersion)) {
      return fail([
        {
          field: 'range',
          code: 'invalid-format',
          message: 'range >= must be followed by valid semver',
        },
      ])
    }
  } else if (!isValidSemver(range)) {
    return fail([
      { field: 'range', code: 'invalid-format', message: 'range must be valid semver or >=x.y.z' },
    ])
  }

  return ok()
}

/**
 * Validate command action.
 */
export function validateAction(action: unknown): ValidationResult {
  if (typeof action !== 'string') {
    return fail([{ field: 'action', code: 'invalid-type', message: 'action must be a string' }])
  }

  if (!(REGISTRY_COMMAND_ACTIONS as readonly string[]).includes(action)) {
    return fail([
      {
        field: 'action',
        code: 'invalid-value',
        message: `action must be one of: ${REGISTRY_COMMAND_ACTIONS.join(', ')}`,
      },
    ])
  }

  return ok()
}

/**
 * Validate preview handle format (8-char hex).
 */
export function validateHandle(handle: unknown): ValidationResult {
  if (typeof handle !== 'string') {
    return fail([{ field: 'handle', code: 'invalid-type', message: 'handle must be a string' }])
  }

  if (!/^[0-9a-f]{8,64}$/.test(handle)) {
    return fail([
      {
        field: 'handle',
        code: 'invalid-format',
        message: 'handle must be a hex string (8-64 chars)',
      },
    ])
  }

  return ok()
}

/**
 * Validate plugin identity format (lowercase namespace).
 */
export function validatePluginIdentity(identity: unknown): ValidationResult {
  if (typeof identity !== 'string') {
    return fail([
      { field: 'pluginIdentity', code: 'invalid-type', message: 'pluginIdentity must be a string' },
    ])
  }

  if (identity.length === 0 || identity.length > 200) {
    return fail([
      {
        field: 'pluginIdentity',
        code: 'invalid-length',
        message: 'pluginIdentity must be 1-200 characters',
      },
    ])
  }

  if (!/^[a-z0-9][a-z0-9._-]*$/.test(identity)) {
    return fail([
      {
        field: 'pluginIdentity',
        code: 'invalid-format',
        message: 'pluginIdentity must be lowercase with dots, hyphens, or underscores',
      },
    ])
  }

  return ok()
}

/**
 * Validate organization ID (non-empty string).
 */
export function validateOrganizationId(orgId: unknown): ValidationResult {
  if (typeof orgId !== 'string' || orgId.length === 0) {
    return fail([
      { field: 'organizationId', code: 'invalid-value', message: 'organizationId is required' },
    ])
  }

  return ok()
}

/**
 * Validate reason code.
 */
export function validateReasonCode(code: unknown): ValidationResult {
  if (code === undefined || code === null) return ok()

  if (typeof code !== 'string') {
    return fail([
      { field: 'reasonCode', code: 'invalid-type', message: 'reasonCode must be a string' },
    ])
  }

  // Allow any string for reason codes (flexible audit field)
  if (code.length > 100) {
    return fail([
      {
        field: 'reasonCode',
        code: 'invalid-length',
        message: 'reasonCode must be at most 100 characters',
      },
    ])
  }

  return ok()
}

/**
 * Validate error code.
 */
export function validateErrorCode(code: unknown): ValidationResult {
  if (code === undefined || code === null) return ok()

  if (typeof code !== 'string') {
    return fail([
      { field: 'errorCode', code: 'invalid-type', message: 'errorCode must be a string' },
    ])
  }

  if (!(REGISTRY_ERROR_CODES as readonly string[]).includes(code)) {
    return fail([
      {
        field: 'errorCode',
        code: 'invalid-value',
        message: `errorCode must be one of the registered error codes`,
      },
    ])
  }

  return ok()
}

/**
 * Validate impact set (array of instance IDs).
 */
export function validateImpactSet(instances: unknown, maxSize: number = 50): ValidationResult {
  if (instances === undefined || instances === null) return ok()

  if (!Array.isArray(instances)) {
    return fail([
      { field: 'impactSet', code: 'invalid-type', message: 'impactSet must be an array' },
    ])
  }

  if (instances.length > maxSize) {
    return fail([
      {
        field: 'impactSet',
        code: 'invalid-length',
        message: `impactSet must have at most ${maxSize} items`,
      },
    ])
  }

  for (const [i, instance] of instances.entries()) {
    if (typeof instance !== 'string') {
      return fail([
        {
          field: `impactSet[${i}]`,
          code: 'invalid-type',
          message: 'impact set items must be strings',
        },
      ])
    }
  }

  return ok()
}

/**
 * Validate a combined create/release input.
 */
export function validateCreateReleaseInput(input: {
  pluginIdentity?: unknown
  version?: unknown
  packageDigest?: unknown
  manifestDigest?: unknown
  compatibilityDigest?: unknown
  upstreamReceiptRef?: unknown
}): ValidationResult {
  const errors: ValidationError[] = []

  const identityResult = validatePluginIdentity(input.pluginIdentity)
  if (!identityResult.valid) errors.push(...identityResult.errors)

  const versionResult = validateVersion(input.version)
  if (!versionResult.valid) errors.push(...versionResult.errors)

  if (typeof input.packageDigest !== 'string' || !input.packageDigest.startsWith('sha256:')) {
    errors.push({
      field: 'packageDigest',
      code: 'invalid-format',
      message: 'packageDigest must be a sha256 hash',
    })
  }

  if (typeof input.manifestDigest !== 'string' || !input.manifestDigest.startsWith('sha256:')) {
    errors.push({
      field: 'manifestDigest',
      code: 'invalid-format',
      message: 'manifestDigest must be a sha256 hash',
    })
  }

  if (
    typeof input.compatibilityDigest !== 'string' ||
    !input.compatibilityDigest.startsWith('sha256:')
  ) {
    errors.push({
      field: 'compatibilityDigest',
      code: 'invalid-format',
      message: 'compatibilityDigest must be a sha256 hash',
    })
  }

  if (typeof input.upstreamReceiptRef !== 'string' || input.upstreamReceiptRef.length === 0) {
    errors.push({
      field: 'upstreamReceiptRef',
      code: 'required',
      message: 'upstreamReceiptRef is required',
    })
  }

  return errors.length === 0 ? ok() : fail(errors)
}

/**
 * Validate confirm request input.
 */
export function validateConfirmInput(input: {
  handle?: unknown
  organizationId?: unknown
  action?: unknown
}): ValidationResult {
  const errors: ValidationError[] = []

  const handleResult = validateHandle(input.handle)
  if (!handleResult.valid) errors.push(...handleResult.errors)

  const orgResult = validateOrganizationId(input.organizationId)
  if (!orgResult.valid) errors.push(...orgResult.errors)

  const actionResult = validateAction(input.action)
  if (!actionResult.valid) errors.push(...actionResult.errors)

  return errors.length === 0 ? ok() : fail(errors)
}

/**
 * Combine multiple validation results.
 */
export function combineValidations(...results: ValidationResult[]): ValidationResult {
  const allErrors = results.flatMap((r) => r.errors)
  return allErrors.length === 0 ? ok() : fail(allErrors)
}
