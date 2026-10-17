// v2-5-typescript-sdk-full-api-coverage -- route/OpenAPI/SDK/test coverage gate.

import type {
  NormalizedSdkEndpointRegistryEntry,
  SdkEndpointRegistryEntry,
} from './registry-loader.js'
import { normalizeEndpointRegistry, toOpenApiPathStyle } from './registry-loader.js'

export interface SdkCoverageEndpoint {
  method: string
  path: string
}

export interface SdkCoverageInputs {
  routeInventory: readonly SdkCoverageEndpoint[]
  openApiOperations: readonly SdkCoverageEndpoint[]
  whitelist?: readonly string[]
  registry: readonly SdkEndpointRegistryEntry[]
  fixtureTestIds: readonly string[]
}

export interface SdkCoverageReport {
  totals: {
    routeOperations: number
    openApiOperations: number
    registryEntries: number
    covered: number
    unsupported: number
    deferred: number
    excluded: number
  }
  sdkMissing: SdkCoverageEndpoint[]
  sdkExtra: NormalizedSdkEndpointRegistryEntry[]
  testMissing: NormalizedSdkEndpointRegistryEntry[]
  codeOnly: SdkCoverageEndpoint[]
  docOnly: SdkCoverageEndpoint[]
  inventoryStale: SdkCoverageEndpoint[]
  duplicateMappings: string[]
  whitelist: SdkCoverageEndpoint[]
  unsupported: NormalizedSdkEndpointRegistryEntry[]
  deferred: NormalizedSdkEndpointRegistryEntry[]
  excluded: NormalizedSdkEndpointRegistryEntry[]
  passed: boolean
}

function keyOf(endpoint: SdkCoverageEndpoint): string {
  return `${endpoint.method.toUpperCase()} ${toOpenApiPathStyle(endpoint.path)}`
}

function normalizeEndpoint(endpoint: SdkCoverageEndpoint): SdkCoverageEndpoint {
  return {
    method: endpoint.method.toUpperCase(),
    path: toOpenApiPathStyle(endpoint.path.replace(/\/+/g, '/').replace(/\/$/, '') || '/'),
  }
}

function endpointFromKey(key: string): SdkCoverageEndpoint {
  const [method, ...pathParts] = key.split(' ')
  return { method: method ?? '', path: pathParts.join(' ') }
}

function whitelistSet(whitelist: readonly string[] = []): Set<string> {
  return new Set(
    whitelist.map((item) => {
      const [method, ...pathParts] = item.split(' ')
      return `${method?.toUpperCase()} ${toOpenApiPathStyle(pathParts.join(' '))}`
    }),
  )
}

export function evaluateSdkCoverage(inputs: SdkCoverageInputs): SdkCoverageReport {
  const fixtureIds = new Set(inputs.fixtureTestIds)
  const whitelistKeys = whitelistSet(inputs.whitelist)
  const duplicateMappings: string[] = []
  const seen = new Set<string>()
  const uniqueRegistry = inputs.registry.filter((entry) => {
    const key = keyOf({ method: entry.method, path: entry.path })
    if (seen.has(key)) {
      duplicateMappings.push(key)
      return false
    }
    seen.add(key)
    return true
  })
  const registry = normalizeEndpointRegistry(uniqueRegistry)

  const routeEndpoints = inputs.routeInventory.map(normalizeEndpoint)
  const openApiEndpoints = inputs.openApiOperations.map(normalizeEndpoint)
  const routeSet = new Set(routeEndpoints.map(keyOf))
  const openApiSet = new Set(openApiEndpoints.map(keyOf))
  const formalRouteSet = new Set([...routeSet].filter((key) => !whitelistKeys.has(key)))
  const registrySet = new Set(registry.map((entry) => entry.key))

  const codeOnly = [...formalRouteSet]
    .filter((key) => !openApiSet.has(key))
    .map(endpointFromKey)
    .sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
  const docOnly = [...openApiSet]
    .filter((key) => !formalRouteSet.has(key) && !whitelistKeys.has(key))
    .map(endpointFromKey)
    .sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
  const inventoryStale = codeOnly.length || docOnly.length ? [...codeOnly, ...docOnly] : []

  const sdkMissing = [...formalRouteSet]
    .filter((key) => !registrySet.has(key))
    .map(endpointFromKey)
    .sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
  const sdkExtra = registry
    .filter(
      (entry) => !formalRouteSet.has(entry.key) && entry.supportStatus !== 'excluded-by-policy',
    )
    .sort((a, b) => a.key.localeCompare(b.key))
  const testMissing = registry.filter(
    (entry) => entry.supportStatus === 'covered' && !fixtureIds.has(entry.fixtureTestId ?? ''),
  )

  const unsupported = registry.filter((entry) => entry.supportStatus === 'unsupported-with-reason')
  const deferred = registry.filter((entry) => entry.supportStatus === 'deferred-with-owner')
  const excluded = registry.filter((entry) => entry.supportStatus === 'excluded-by-policy')
  const covered = registry.filter((entry) => entry.supportStatus === 'covered')
  const whitelisted = [...whitelistKeys]
    .map(endpointFromKey)
    .sort((a, b) => keyOf(a).localeCompare(keyOf(b)))

  const passed =
    sdkMissing.length === 0 &&
    sdkExtra.length === 0 &&
    testMissing.length === 0 &&
    codeOnly.length === 0 &&
    docOnly.length === 0 &&
    inventoryStale.length === 0 &&
    duplicateMappings.length === 0

  return {
    totals: {
      routeOperations: formalRouteSet.size,
      openApiOperations: openApiSet.size,
      registryEntries: registry.length,
      covered: covered.length,
      unsupported: unsupported.length,
      deferred: deferred.length,
      excluded: excluded.length,
    },
    sdkMissing,
    sdkExtra,
    testMissing,
    codeOnly,
    docOnly,
    inventoryStale,
    duplicateMappings,
    whitelist: whitelisted,
    unsupported,
    deferred,
    excluded,
    passed,
  }
}

export function formatSdkCoverageSummary(report: SdkCoverageReport): string {
  const lines = [
    '=== SDK /api/v1 coverage ===',
    `  route operations: ${report.totals.routeOperations}`,
    `  OpenAPI operations: ${report.totals.openApiOperations}`,
    `  registry entries: ${report.totals.registryEntries}`,
    `  covered: ${report.totals.covered}`,
    `  unsupported: ${report.totals.unsupported}`,
    `  deferred: ${report.totals.deferred}`,
    `  excluded: ${report.totals.excluded}`,
  ]
  const sections: Array<[string, readonly unknown[]]> = [
    ['SDK-missing', report.sdkMissing],
    ['SDK-extra', report.sdkExtra],
    ['test-missing', report.testMissing],
    ['code-only', report.codeOnly],
    ['doc-only', report.docOnly],
    ['inventory-stale', report.inventoryStale],
    ['duplicate-mappings', report.duplicateMappings],
  ]
  for (const [label, items] of sections) {
    if (items.length) lines.push(`  ${label}: ${items.length}`)
  }
  lines.push(report.passed ? '  result: pass' : '  result: fail')
  return lines.join('\n')
}
