import { describe, expect, test } from 'vitest'
import type {
  SdkLocalDeferredEndpoint,
  SdkLocalEndpointEnvelope,
  SdkLocalEndpointRequest,
} from './sdk-local-types.js'

describe('SDK-local endpoint types', () => {
  test('stay transport-oriented and do not expose backend model internals', () => {
    const request: SdkLocalEndpointRequest<{ name: string }> = {
      path: { projectId: 1 },
      query: { include: ['assignee', 'parent'] },
      body: { name: 'Task' },
    }
    const envelope: SdkLocalEndpointEnvelope<{ id: number }> = { data: { id: 1 } }
    const deferred: SdkLocalDeferredEndpoint = {
      method: 'GET',
      path: '/api/v1/ai/project-drafts/:id/events',
      reason: 'SSE helper deferred.',
      owner: 'sdk-streaming-owner',
    }
    expect(Object.keys(request)).toEqual(['path', 'query', 'body'])
    expect(envelope.data?.id).toBe(1)
    expect(deferred.owner).toBe('sdk-streaming-owner')
    expect('serialize' in request).toBe(false)
    expect('queryBuilder' in request).toBe(false)
  })
})
