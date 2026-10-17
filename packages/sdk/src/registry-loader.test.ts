import { describe, expect, test } from 'vitest'
import { normalizeEndpointRegistry, type SdkEndpointRegistryEntry } from './registry-loader.js'

const baseEntry: SdkEndpointRegistryEntry = {
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

describe('SDK endpoint registry loader', () => {
  test('accepts a valid covered entry and normalizes path/key/export name', () => {
    const [entry] = normalizeEndpointRegistry([baseEntry])
    expect(entry?.key).toBe('GET /api/v1/projects/{id}')
    expect(entry?.openApiPath).toBe('/api/v1/projects/{id}')
    expect(entry?.exportName).toBe('projectsShow')
  })

  test('accepts unsupported, deferred, and excluded entries with owner and reason', () => {
    const entries = normalizeEndpointRegistry([
      {
        ...baseEntry,
        method: 'POST',
        path: '/api/v1/projects/:projectId/files',
        operationId: 'filesStore',
        sdkExportPath: 'AiprojClient.coverage.filesStore',
        supportStatus: 'unsupported-with-reason',
        fixtureTestId: 'sdk-fixture:file-transfer-classification',
        owner: 'sdk-file-transfer-owner',
        reason: 'Requires form-data handling.',
      },
      {
        ...baseEntry,
        path: '/api/v1/ai/project-drafts/:id/events',
        operationId: 'draftEvents',
        sdkExportPath: 'AiprojClient.coverage.draftEvents',
        supportStatus: 'deferred-with-owner',
        fixtureTestId: 'sdk-fixture:sse-classification',
        owner: 'sdk-streaming-owner',
        reason: 'Requires SSE helper.',
      },
      {
        ...baseEntry,
        method: 'POST',
        path: '/api/v1/webhooks/:provider',
        domain: 'ai-compiler-integration',
        operationId: 'webhooksReceive',
        sdkExportPath: 'AiprojClient.coverage.webhooksReceive',
        supportStatus: 'excluded-by-policy',
        fixtureTestId: 'sdk-fixture:policy-exclusion',
        owner: 'sdk-security-owner',
        reason: 'External provider ingress is not a consumer SDK endpoint.',
      },
    ])
    expect(entries.map((entry) => entry.supportStatus).sort()).toEqual([
      'deferred-with-owner',
      'excluded-by-policy',
      'unsupported-with-reason',
    ])
  })

  test('rejects missing reason for a classified entry', () => {
    expect(() =>
      normalizeEndpointRegistry([
        {
          ...baseEntry,
          supportStatus: 'deferred-with-owner',
          reason: '',
        },
      ]),
    ).toThrow(/reason/)
  })

  test('rejects duplicate method/path mappings', () => {
    expect(() => normalizeEndpointRegistry([baseEntry, { ...baseEntry }])).toThrow(/duplicate/)
  })

  test('rejects invalid non-/api/v1 paths and malformed entries', () => {
    expect(() => normalizeEndpointRegistry([{ ...baseEntry, path: '/api/v2/projects' }])).toThrow(
      /non-\/api\/v1/,
    )
    expect(() =>
      normalizeEndpointRegistry([{ ...baseEntry, operationId: undefined, routeName: undefined }]),
    ).toThrow(/operationId or routeName/)
  })

  test('sorts deterministically and preserves operationId and routeName', () => {
    const entries = normalizeEndpointRegistry([
      { ...baseEntry, method: 'POST', path: '/api/v1/users', operationId: 'usersStore' },
      { ...baseEntry, method: 'GET', path: '/api/v1/projects', operationId: 'projectsIndex' },
    ])
    expect(entries.map((entry) => entry.key)).toEqual([
      'GET /api/v1/projects',
      'POST /api/v1/users',
    ])
    expect(entries[1]?.operationId).toBe('usersStore')
    expect(entries[1]?.routeName).toBe('projects.show')
  })
})
