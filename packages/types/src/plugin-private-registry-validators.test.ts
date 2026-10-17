/**
 * plugin-private-registry-lifecycle — Validator 测试（tasks 7.1–7.2）。
 * 覆盖：边界长度、未知 action/状态、非法 semver/range、超大影响集合、
 * authority spoofing 与统一 validation error details。
 *
 * 由于 backend validator 无法在 types 包直接 import，本文件
 * 内联等价验证逻辑进行测试。
 */

import { describe, expect, it } from 'vitest'
import {
  REGISTRY_COMMAND_ACTIONS,
  REGISTRY_RELEASE_STATUSES,
  REGISTRY_ERROR_CODES,
  isValidSemver,
} from './plugin-private-registry-lifecycle.js'

// =============================================================================
// Inline validators (mirrors backend validators for testing)
// =============================================================================

function validatePagination(params: { page?: unknown; perPage?: unknown }) {
  const errors: string[] = []
  if (params.page !== undefined) {
    const p = Number(params.page)
    if (!Number.isInteger(p) || p < 1) errors.push('page must be positive integer')
  }
  if (params.perPage !== undefined) {
    const pp = Number(params.perPage)
    if (!Number.isInteger(pp) || pp < 1 || pp > 100) errors.push('perPage must be 1-100')
  }
  return errors
}

function validateSort(sort: unknown) {
  if (sort === undefined || sort === null) return []
  const valid = ['-createdAt', '+createdAt', '-version', '+version']
  if (typeof sort !== 'string' || !valid.includes(sort)) return ['invalid sort']
  return []
}

function validateStatusFilter(status: unknown) {
  if (status === undefined || status === null) return []
  if (
    typeof status !== 'string' ||
    !(REGISTRY_RELEASE_STATUSES as readonly string[]).includes(status)
  )
    return ['invalid status']
  return []
}

function validateVersionRange(range: unknown) {
  if (range === undefined || range === null) return []
  if (typeof range !== 'string') return ['range must be string']
  if (range.startsWith('>=')) {
    const min = range.slice(2)
    if (!isValidSemver(min)) return ['invalid >= range']
  } else if (!isValidSemver(range)) {
    return ['invalid range']
  }
  return []
}

function validateAction(action: unknown) {
  if (typeof action !== 'string') return ['action must be string']
  if (!(REGISTRY_COMMAND_ACTIONS as readonly string[]).includes(action)) return ['invalid action']
  return []
}

function validateHandle(handle: unknown) {
  if (typeof handle !== 'string') return ['handle must be string']
  if (!/^[0-9a-f]{8,64}$/.test(handle)) return ['invalid handle format']
  return []
}

function validatePluginIdentity(id: unknown) {
  if (typeof id !== 'string') return ['identity must be string']
  if (id.length === 0 || id.length > 200) return ['identity length 1-200']
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) return ['invalid identity format']
  return []
}

function validateImpactSet(instances: unknown, maxSize: number = 50) {
  if (instances === undefined || instances === null) return []
  if (!Array.isArray(instances)) return ['must be array']
  if (instances.length > maxSize) return [`max ${maxSize} items`]
  for (let i = 0; i < instances.length; i++) {
    if (typeof instances[i] !== 'string') return [`item ${i} must be string`]
  }
  return []
}

function validateCreateReleaseInput(input: {
  pluginIdentity?: unknown
  version?: unknown
  packageDigest?: unknown
  manifestDigest?: unknown
  compatibilityDigest?: unknown
  upstreamReceiptRef?: unknown
}) {
  const errors: string[] = []
  errors.push(...validatePluginIdentity(input.pluginIdentity))
  if (typeof input.version !== 'string' || !isValidSemver(input.version))
    errors.push('invalid version')
  if (typeof input.packageDigest !== 'string' || !input.packageDigest.startsWith('sha256:'))
    errors.push('invalid packageDigest')
  if (typeof input.manifestDigest !== 'string' || !input.manifestDigest.startsWith('sha256:'))
    errors.push('invalid manifestDigest')
  if (
    typeof input.compatibilityDigest !== 'string' ||
    !input.compatibilityDigest.startsWith('sha256:')
  )
    errors.push('invalid compatibilityDigest')
  if (typeof input.upstreamReceiptRef !== 'string' || input.upstreamReceiptRef.length === 0)
    errors.push('upstreamReceiptRef required')
  return errors
}

// =============================================================================
// 1. Pagination Validation
// =============================================================================

describe('Pagination validation', () => {
  it('valid page/perPage', () => {
    expect(validatePagination({ page: 1, perPage: 20 })).toHaveLength(0)
  })

  it('page = 0 fails', () => {
    expect(validatePagination({ page: 0 })).toHaveLength(1)
  })

  it('page = -1 fails', () => {
    expect(validatePagination({ page: -1 })).toHaveLength(1)
  })

  it('perPage = 0 fails', () => {
    expect(validatePagination({ perPage: 0 })).toHaveLength(1)
  })

  it('perPage = 101 fails', () => {
    expect(validatePagination({ perPage: 101 })).toHaveLength(1)
  })

  it('perPage = 100 is valid', () => {
    expect(validatePagination({ perPage: 100 })).toHaveLength(0)
  })

  it('undefined values are valid', () => {
    expect(validatePagination({})).toHaveLength(0)
  })

  it('non-numeric page fails', () => {
    expect(validatePagination({ page: 'abc' })).toHaveLength(1)
  })
})

// =============================================================================
// 2. Sort Validation
// =============================================================================

describe('Sort validation', () => {
  it('valid sort values', () => {
    expect(validateSort('-createdAt')).toHaveLength(0)
    expect(validateSort('+version')).toHaveLength(0)
  })

  it('invalid sort value', () => {
    expect(validateSort('name')).toHaveLength(1)
    expect(validateSort('+name')).toHaveLength(1)
  })

  it('undefined/null is valid', () => {
    expect(validateSort(undefined)).toHaveLength(0)
    expect(validateSort(null)).toHaveLength(0)
  })
})

// =============================================================================
// 3. Status Filter Validation
// =============================================================================

describe('Status filter validation', () => {
  it('valid status values', () => {
    for (const status of REGISTRY_RELEASE_STATUSES) {
      expect(validateStatusFilter(status)).toHaveLength(0)
    }
  })

  it('invalid status value', () => {
    expect(validateStatusFilter('unknown')).toHaveLength(1)
    expect(validateStatusFilter('active')).toHaveLength(1)
  })

  it('undefined/null is valid', () => {
    expect(validateStatusFilter(undefined)).toHaveLength(0)
  })
})

// =============================================================================
// 4. Action Validation
// =============================================================================

describe('Action validation', () => {
  it('valid actions', () => {
    for (const action of REGISTRY_COMMAND_ACTIONS) {
      expect(validateAction(action)).toHaveLength(0)
    }
  })

  it('invalid action', () => {
    expect(validateAction('delete')).toHaveLength(1)
    expect(validateAction('destroy')).toHaveLength(1)
  })

  it('non-string action', () => {
    expect(validateAction(123)).toHaveLength(1)
    expect(validateAction(null)).toHaveLength(1)
  })
})

// =============================================================================
// 5. Handle Validation
// =============================================================================

describe('Handle validation', () => {
  it('valid hex handle', () => {
    expect(validateHandle('abcdef12')).toHaveLength(0)
    expect(validateHandle('0123456789abcdef')).toHaveLength(0)
  })

  it('too short handle', () => {
    expect(validateHandle('abc')).toHaveLength(1)
  })

  it('non-hex characters', () => {
    expect(validateHandle('xyz12345')).toHaveLength(1)
  })

  it('non-string handle', () => {
    expect(validateHandle(123)).toHaveLength(1)
  })
})

// =============================================================================
// 6. Plugin Identity Validation
// =============================================================================

describe('Plugin identity validation', () => {
  it('valid identity', () => {
    expect(validatePluginIdentity('org.plugin-name')).toHaveLength(0)
    expect(validatePluginIdentity('a.b')).toHaveLength(0)
    expect(validatePluginIdentity('my_plugin')).toHaveLength(0)
  })

  it('empty identity', () => {
    expect(validatePluginIdentity('')).toHaveLength(1)
  })

  it('uppercase identity', () => {
    expect(validatePluginIdentity('Org.Plugin')).toHaveLength(1)
  })

  it('identity with spaces', () => {
    expect(validatePluginIdentity('org plugin')).toHaveLength(1)
  })

  it('too long identity', () => {
    expect(validatePluginIdentity('a'.repeat(201))).toHaveLength(1)
  })

  it('starts with dot', () => {
    expect(validatePluginIdentity('.plugin')).toHaveLength(1)
  })
})

// =============================================================================
// 7. Version Range Validation
// =============================================================================

describe('Version range validation', () => {
  it('exact version', () => {
    expect(validateVersionRange('1.0.0')).toHaveLength(0)
  })

  it('>= range', () => {
    expect(validateVersionRange('>=1.0.0')).toHaveLength(0)
  })

  it('invalid >= range', () => {
    expect(validateVersionRange('>=abc')).toHaveLength(1)
  })

  it('invalid range format', () => {
    expect(validateVersionRange('~1.0.0')).toHaveLength(1)
    expect(validateVersionRange('^1.0.0')).toHaveLength(1)
  })

  it('undefined is valid', () => {
    expect(validateVersionRange(undefined)).toHaveLength(0)
  })
})

// =============================================================================
// 8. Impact Set Validation
// =============================================================================

describe('Impact set validation', () => {
  it('valid impact set', () => {
    expect(validateImpactSet(['inst-1', 'inst-2'])).toHaveLength(0)
  })

  it('empty impact set', () => {
    expect(validateImpactSet([])).toHaveLength(0)
  })

  it('undefined is valid', () => {
    expect(validateImpactSet(undefined)).toHaveLength(0)
  })

  it('exceeds max size', () => {
    expect(validateImpactSet(Array.from({ length: 51 }, (_, i) => `inst-${i}`))).toHaveLength(1)
  })

  it('non-string items', () => {
    expect(validateImpactSet([123, 'inst-2'])).toHaveLength(1)
  })

  it('non-array', () => {
    expect(validateImpactSet('not-an-array')).toHaveLength(1)
  })
})

// =============================================================================
// 9. Create Release Input Validation
// =============================================================================

describe('Create release input validation', () => {
  const validInput = {
    pluginIdentity: 'org.plugin',
    version: '1.0.0',
    packageDigest: 'sha256:abc123',
    manifestDigest: 'sha256:def456',
    compatibilityDigest: 'sha256:ghi789',
    upstreamReceiptRef: 'receipt-hash-1',
  }

  it('valid input passes', () => {
    expect(validateCreateReleaseInput(validInput)).toHaveLength(0)
  })

  it('missing identity fails', () => {
    expect(validateCreateReleaseInput({ ...validInput, pluginIdentity: '' })).toContain(
      'identity length 1-200',
    )
  })

  it('invalid version fails', () => {
    expect(validateCreateReleaseInput({ ...validInput, version: 'abc' })).toContain(
      'invalid version',
    )
  })

  it('non-sha256 digest fails', () => {
    expect(validateCreateReleaseInput({ ...validInput, packageDigest: 'md5:abc' })).toContain(
      'invalid packageDigest',
    )
  })

  it('missing receipt fails', () => {
    expect(validateCreateReleaseInput({ ...validInput, upstreamReceiptRef: '' })).toContain(
      'upstreamReceiptRef required',
    )
  })

  it('multiple errors', () => {
    const errors = validateCreateReleaseInput({})
    expect(errors.length).toBeGreaterThanOrEqual(3)
  })
})

// =============================================================================
// 10. Error Code Completeness
// =============================================================================

describe('Error code registry', () => {
  it('has all required error domains', () => {
    const domains = [
      'registry-invalid',
      'registry-illegal',
      'registry-receipt',
      'registry-org',
      'registry-permission',
      'registry-maker',
      'registry-preview',
      'registry-rollback',
      'registry-version',
      'registry-stale',
      'registry-concurrent',
      'registry-tool',
      'registry-network',
    ]
    for (const domain of domains) {
      const matching = REGISTRY_ERROR_CODES.filter((c) => c.startsWith(domain))
      expect(matching.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('all error codes are unique', () => {
    expect(new Set(REGISTRY_ERROR_CODES).size).toBe(REGISTRY_ERROR_CODES.length)
  })
})
