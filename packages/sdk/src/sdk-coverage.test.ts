import { describe, expect, test } from 'vitest'
import { evaluateSdkCoverage } from './sdk-coverage.js'
import type { SdkEndpointRegistryEntry } from './registry-loader.js'

const covered: SdkEndpointRegistryEntry = {
  method: 'GET',
  path: '/api/v1/projects/:id',
  domain: 'planning',
  operationId: 'projectsShow',
  routeName: 'projects.show',
  sdkExportPath: 'AiprojClient.api.planning.projectsShow',
  supportStatus: 'covered',
  fixtureTestId: 'sdk-fixture:planning-domain',
  owner: 'sdk-planning',
  reason: 'Covered by typed SDK domain client.',
}

function evaluate(registry: SdkEndpointRegistryEntry[] = [covered]) {
  return evaluateSdkCoverage({
    routeInventory: [{ method: 'GET', path: '/api/v1/projects/:id' }],
    openApiOperations: [{ method: 'GET', path: '/api/v1/projects/{id}' }],
    whitelist: ['GET /api/v1/health'],
    registry,
    fixtureTestIds: ['sdk-fixture:planning-domain'],
  })
}

describe('SDK coverage gate', () => {
  test('passes when route, OpenAPI, SDK registry, and fixture ids align', () => {
    const report = evaluate()
    expect(report.passed).toBe(true)
    expect(report.totals.covered).toBe(1)
  })

  test('reports SDK-missing and SDK-extra', () => {
    expect(evaluate([]).sdkMissing).toEqual([{ method: 'GET', path: '/api/v1/projects/{id}' }])
    const report = evaluate([{ ...covered, path: '/api/v1/users' }])
    expect(report.sdkExtra[0]?.key).toBe('GET /api/v1/users')
  })

  test('reports test-missing for covered entries without registered fixture id', () => {
    const report = evaluate([{ ...covered, fixtureTestId: 'missing-fixture' }])
    expect(report.testMissing[0]?.fixtureTestId).toBe('missing-fixture')
    expect(report.passed).toBe(false)
  })

  test('reports code-only, doc-only, and inventory-stale without hiding API drift', () => {
    const report = evaluateSdkCoverage({
      routeInventory: [{ method: 'GET', path: '/api/v1/projects' }],
      openApiOperations: [{ method: 'GET', path: '/api/v1/users' }],
      registry: [{ ...covered, path: '/api/v1/projects', operationId: 'projectsIndex' }],
      fixtureTestIds: ['sdk-fixture:planning-domain'],
    })
    expect(report.codeOnly).toEqual([{ method: 'GET', path: '/api/v1/projects' }])
    expect(report.docOnly).toEqual([{ method: 'GET', path: '/api/v1/users' }])
    expect(report.inventoryStale).toHaveLength(2)
  })

  test('reports duplicate mappings at the coverage gate', () => {
    const report = evaluate([covered, { ...covered, operationId: 'projectsShowDuplicate' }])
    expect(report.duplicateMappings).toEqual(['GET /api/v1/projects/{id}'])
    expect(report.passed).toBe(false)
  })

  test('ignores whitelisted endpoints as SDK-missing', () => {
    const report = evaluateSdkCoverage({
      routeInventory: [
        { method: 'GET', path: '/api/v1/projects/:id' },
        { method: 'GET', path: '/api/v1/health' },
      ],
      openApiOperations: [{ method: 'GET', path: '/api/v1/projects/{id}' }],
      whitelist: ['GET /api/v1/health'],
      registry: [covered],
      fixtureTestIds: ['sdk-fixture:planning-domain'],
    })
    expect(report.whitelist).toEqual([{ method: 'GET', path: '/api/v1/health' }])
    expect(report.sdkMissing).toEqual([])
  })

  test('accepts unsupported, deferred, and excluded classifications with reason and owner', () => {
    const report = evaluateSdkCoverage({
      routeInventory: [
        { method: 'GET', path: '/api/v1/projects/:id' },
        { method: 'GET', path: '/api/v1/ai/project-drafts/:id/events' },
        { method: 'POST', path: '/api/v1/projects/:projectId/files' },
      ],
      openApiOperations: [
        { method: 'GET', path: '/api/v1/projects/{id}' },
        { method: 'GET', path: '/api/v1/ai/project-drafts/{id}/events' },
        { method: 'POST', path: '/api/v1/projects/{projectId}/files' },
      ],
      registry: [
        covered,
        {
          ...covered,
          path: '/api/v1/ai/project-drafts/:id/events',
          domain: 'ai-compiler-integration',
          operationId: 'draftEvents',
          sdkExportPath: 'AiprojClient.coverage.draftEvents',
          supportStatus: 'deferred-with-owner',
          fixtureTestId: 'sdk-fixture:sse-classification',
          owner: 'sdk-streaming-owner',
          reason: 'SSE helper deferred.',
        },
        {
          ...covered,
          method: 'POST',
          path: '/api/v1/projects/:projectId/files',
          domain: 'collaboration-reporting',
          operationId: 'filesStore',
          sdkExportPath: 'AiprojClient.coverage.filesStore',
          supportStatus: 'unsupported-with-reason',
          fixtureTestId: 'sdk-fixture:file-transfer-classification',
          owner: 'sdk-file-transfer-owner',
          reason: 'Binary helper unsupported in this pass.',
        },
      ],
      fixtureTestIds: [
        'sdk-fixture:planning-domain',
        'sdk-fixture:sse-classification',
        'sdk-fixture:file-transfer-classification',
      ],
    })
    expect(report.deferred).toHaveLength(1)
    expect(report.unsupported).toHaveLength(1)
    expect(report.excluded).toHaveLength(0)
    expect(report.passed).toBe(true)
  })
})
