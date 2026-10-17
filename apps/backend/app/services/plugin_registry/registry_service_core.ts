/**
 * v3-plugin-private-registry-lifecycle — RegistryService 纯核心（tasks 4.1–4.8）。
 *
 * 纯函数层：release 登记、目录查询、版本解析、deprecated pin/withdrawn 阻断。
 * **零 Adonis/Lucid/数据库依赖**，可被 vitest 直跑。
 *
 * 红线：本核心只产出 DTO/查询条件/解析结果，绝不包含数据库写入或 HTTP 逻辑。
 */

import type {
  PrivateRegistryEntry,
  PrivateRegistryRelease,
  RegistryReleaseStatus,
  RegistryErrorCode,
} from '@aiproj/types'

// =============================================================================
// 1. Release Registration (task 4.1)
// =============================================================================

export interface RegisterReleaseInput {
  readonly organizationId: string
  readonly pluginIdentity: string
  readonly pluginName: string
  readonly version: string
  readonly packageDigest: string
  readonly manifestDigest: string
  readonly compatibilityDigest: string
  readonly upstreamReceiptRef: string
  readonly metadata?: string | null
}

export type RegisterReleaseResult =
  | {
      readonly ok: true
      readonly release: PrivateRegistryRelease
      readonly entry: PrivateRegistryEntry
    }
  | {
      readonly ok: false
      readonly errorCode: RegistryErrorCode
      readonly message: string
    }

/**
 * Validate a release registration input before DB write.
 * Returns null if valid, or error code + message if invalid.
 */
export function validateRegisterReleaseInput(
  input: RegisterReleaseInput,
): { errorCode: RegistryErrorCode; message: string } | null {
  if (!input.pluginIdentity || input.pluginIdentity.length === 0) {
    return { errorCode: 'registry-invalid-identity', message: 'Plugin identity is required' }
  }
  if (!input.version || !/^\d+\.\d+\.\d+$/.test(input.version)) {
    return {
      errorCode: 'registry-invalid-version',
      message: 'Version must be valid semver (MAJOR.MINOR.PATCH)',
    }
  }
  if (!input.packageDigest || !input.packageDigest.startsWith('sha256:')) {
    return {
      errorCode: 'registry-invalid-digest',
      message: 'Package digest must be a valid sha256 hash',
    }
  }
  if (!input.manifestDigest || !input.manifestDigest.startsWith('sha256:')) {
    return {
      errorCode: 'registry-invalid-digest',
      message: 'Manifest digest must be a valid sha256 hash',
    }
  }
  if (!input.compatibilityDigest || !input.compatibilityDigest.startsWith('sha256:')) {
    return {
      errorCode: 'registry-invalid-digest',
      message: 'Compatibility digest must be a valid sha256 hash',
    }
  }
  if (!input.upstreamReceiptRef) {
    return {
      errorCode: 'registry-receipt-invalid',
      message: 'Upstream receipt reference is required',
    }
  }
  return null
}

/**
 * Check for digest conflict: same org + pluginId + version but different digests.
 */
export function checkDigestConflict(
  existing: PrivateRegistryRelease,
  newPackageDigest: string,
  newManifestDigest: string,
): RegistryErrorCode | null {
  if (
    existing.packageDigest !== newPackageDigest ||
    existing.manifestDigest !== newManifestDigest
  ) {
    return 'registry-digest-conflict'
  }
  return null
}

// =============================================================================
// 2. Directory Query (task 4.3)
// =============================================================================

export interface DirectoryListFilter {
  readonly organizationId: string
  readonly status?: RegistryReleaseStatus
  readonly pluginIdentity?: string
  readonly version?: string
  readonly page?: number
  readonly perPage?: number
  readonly sort?: '-createdAt' | '+createdAt' | '-version' | '+version'
}

/**
 * Build query conditions from a directory list filter.
 * Returns an object suitable for Lucid query builder.
 */
export function buildDirectoryListConditions(filter: DirectoryListFilter): Record<string, unknown> {
  const conditions: Record<string, unknown> = {
    organizationId: filter.organizationId,
  }
  if (filter.status) {
    conditions.status = filter.status
  }
  if (filter.pluginIdentity) {
    conditions.pluginIdentity = filter.pluginIdentity
  }
  if (filter.version) {
    conditions.version = filter.version
  }
  return conditions
}

/**
 * Parse sort parameter into Lucid-compatible order.
 */
export function parseDirectorySort(sort: string): { column: string; direction: 'asc' | 'desc' } {
  const direction = sort.startsWith('-') ? 'desc' : 'asc'
  const column = sort.replace(/^[+-]/, '')
  // Map to actual column names
  const columnMap: Record<string, string> = {
    createdAt: 'created_at',
    version: 'version',
    updatedAt: 'updated_at',
  }
  return { column: columnMap[column] ?? 'created_at', direction }
}

// =============================================================================
// 3. Version Resolver (task 4.5)
// =============================================================================

export interface VersionResolverInput {
  readonly releases: readonly PrivateRegistryRelease[]
  readonly requestedRange?: string
  readonly hostVersion?: string
  readonly seamVersions?: Record<string, string>
  readonly includeDeprecated?: boolean
}

export type VersionResolverResult =
  | {
      readonly resolved: true
      readonly release: PrivateRegistryRelease
      readonly isDeprecated: boolean
    }
  | {
      readonly resolved: false
      readonly errorCode: RegistryErrorCode
      readonly message: string
    }

/**
 * Resolve the best version from a set of releases.
 * D7: approved only for default; deprecated requires explicit pin.
 * Sort: semantic version descending, stable ID as tiebreak.
 */
export function resolveVersion(input: VersionResolverInput): VersionResolverResult {
  const candidates = input.releases
    .filter((r) => {
      if (r.status === 'approved') return true
      if (r.status === 'deprecated' && input.includeDeprecated) return true
      return false
    })
    .filter((r) => {
      if (!input.requestedRange) return true
      // Simplified range check: exact match or >= for ">=x.y.z"
      if (input.requestedRange.startsWith('>=')) {
        const minVersion = input.requestedRange.slice(2)
        return compareVersions(r.version, minVersion) >= 0
      }
      return r.version === input.requestedRange
    })
    .sort((a, b) => {
      const vc = compareVersions(b.version, a.version)
      if (vc !== 0) return vc
      return a.id.localeCompare(b.id)
    })

  if (candidates.length === 0) {
    return {
      resolved: false,
      errorCode: 'registry-no-compatible-version',
      message: 'No compatible approved version found',
    }
  }

  const best = candidates[0]
  return {
    resolved: true,
    release: best,
    isDeprecated: best.status === 'deprecated',
  }
}

// =============================================================================
// 4. Deprecated Pin & Withdrawn Blocking (task 4.7)
// =============================================================================

/**
 * Check if a release can be explicitly pinned (deprecated releases only).
 */
export function canExplicitPin(
  release: PrivateRegistryRelease,
  hasManagePermission: boolean,
): RegistryErrorCode | null {
  if (release.status !== 'deprecated') {
    return 'registry-illegal-status-transition'
  }
  if (!hasManagePermission) {
    return 'registry-permission-denied'
  }
  return null
}

/**
 * Check if a release is excluded from resolution/installation.
 * Withdrawn releases are always excluded.
 */
export function isExcludedFromResolution(status: RegistryReleaseStatus): boolean {
  return (
    status === 'withdrawn' ||
    status === 'rejected' ||
    status === 'pending_review' ||
    status === 'draft'
  )
}

// =============================================================================
// Helpers
// =============================================================================

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na < nb) return -1
    if (na > nb) return 1
  }
  return 0
}
