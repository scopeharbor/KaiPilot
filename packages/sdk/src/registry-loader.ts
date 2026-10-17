// v2-5-typescript-sdk-full-api-coverage -- SDK endpoint registry schema/loader.

export const SDK_COVERAGE_STATUSES = [
  'covered',
  'unsupported-with-reason',
  'deferred-with-owner',
  'excluded-by-policy',
] as const

export type SdkCoverageStatus = (typeof SDK_COVERAGE_STATUSES)[number]

export const SDK_ENDPOINT_DOMAINS = [
  'identity',
  'organization',
  'planning',
  'schedule-resource-risk',
  'collaboration-reporting',
  'ai-compiler-integration',
] as const

export type SdkEndpointDomain = (typeof SDK_ENDPOINT_DOMAINS)[number]

export interface SdkEndpointRegistryEntry {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  domain: SdkEndpointDomain
  operationId?: string
  routeName?: string
  sdkExportPath: string
  supportStatus: SdkCoverageStatus
  fixtureTestId?: string
  owner: string
  reason: string
}

export interface NormalizedSdkEndpointRegistryEntry extends SdkEndpointRegistryEntry {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  openApiPath: string
  key: string
  exportName: string
}

const VALID_METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])
const VALID_STATUSES = new Set<string>(SDK_COVERAGE_STATUSES)
const VALID_DOMAINS = new Set<string>(SDK_ENDPOINT_DOMAINS)

export function toOpenApiPathStyle(path: string): string {
  return path.replace(/:(\w+)/g, '{$1}')
}

export function normalizeRegistryPath(path: string): string {
  const normalized = path.replace(/\/+/g, '/').replace(/\/$/, '')
  return normalized || '/'
}

function parseExportName(sdkExportPath: string): string {
  const parts = sdkExportPath.split('.').filter(Boolean)
  return parts[parts.length - 1] ?? sdkExportPath
}

export function normalizeEndpointRegistry(
  entries: readonly SdkEndpointRegistryEntry[],
): NormalizedSdkEndpointRegistryEntry[] {
  const normalized = entries.map((entry, index) => {
    const method = entry.method.toUpperCase()
    const path = normalizeRegistryPath(entry.path)
    const problems: string[] = []

    if (!VALID_METHODS.has(method)) problems.push(`invalid method ${entry.method}`)
    if (!path.startsWith('/api/v1/')) problems.push(`invalid non-/api/v1 path ${path}`)
    if (!VALID_DOMAINS.has(entry.domain)) problems.push(`invalid domain ${entry.domain}`)
    if (!VALID_STATUSES.has(entry.supportStatus)) {
      problems.push(`invalid support status ${entry.supportStatus}`)
    }
    if (!entry.operationId && !entry.routeName) {
      problems.push('operationId or routeName is required')
    }
    if (!entry.sdkExportPath) problems.push('sdkExportPath is required')
    if (!entry.owner) problems.push('owner is required')
    if (!entry.reason) problems.push('reason is required')
    if (entry.supportStatus === 'covered' && !entry.fixtureTestId) {
      problems.push('covered entries require fixtureTestId')
    }
    if (entry.supportStatus !== 'covered' && !entry.reason.trim()) {
      problems.push('classified non-covered entries require reason')
    }

    if (problems.length) {
      throw new Error(`SDK endpoint registry entry ${index} is invalid: ${problems.join('; ')}`)
    }

    return {
      ...entry,
      method: method as NormalizedSdkEndpointRegistryEntry['method'],
      path,
      openApiPath: toOpenApiPathStyle(path),
      key: `${method} ${toOpenApiPathStyle(path)}`,
      exportName: parseExportName(entry.sdkExportPath),
    }
  })

  const seen = new Map<string, NormalizedSdkEndpointRegistryEntry>()
  const duplicateKeys = new Set<string>()
  for (const entry of normalized) {
    if (seen.has(entry.key)) duplicateKeys.add(entry.key)
    seen.set(entry.key, entry)
  }
  if (duplicateKeys.size) {
    throw new Error(
      `SDK endpoint registry has duplicate method/path mappings: ${[...duplicateKeys].join(', ')}`,
    )
  }

  return [...normalized].sort((a, b) => {
    const byPath = a.openApiPath.localeCompare(b.openApiPath)
    if (byPath !== 0) return byPath
    return a.method.localeCompare(b.method)
  })
}
