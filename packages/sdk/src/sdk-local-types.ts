// v2-5-typescript-sdk-full-api-coverage -- endpoint-local SDK types.
//
// These are intentionally transport-oriented helper shapes, not backend Model mirrors.

import type { QueryValue } from './query.js'

export interface SdkLocalEndpointRequest<TBody = unknown> {
  path?: Record<string, string | number | boolean>
  query?: Record<string, QueryValue>
  body?: TBody
}

export interface SdkLocalEndpointEnvelope<TData = unknown> {
  data?: TData
  meta?: unknown
  error?: {
    code: string
    message: string
    details?: unknown
  }
}

export interface SdkLocalDeferredEndpoint {
  method: string
  path: string
  reason: string
  owner: string
}
