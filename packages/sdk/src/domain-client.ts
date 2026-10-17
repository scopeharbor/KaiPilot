// v2-5-typescript-sdk-full-api-coverage -- registry-driven JSON domain clients.

import type { PaginatedResponse } from '@aiproj/types'
import type { AiprojClientConfig, RequestOptions } from './transport.js'
import { parseApiError } from './errors.js'
import type { QueryValue } from './query.js'
import { toQueryString } from './query.js'
import type { NormalizedSdkEndpointRegistryEntry, SdkEndpointDomain } from './registry-loader.js'
import { normalizeBaseUrl, rawRequest } from './transport.js'

export type SdkPathParams = Record<string, string | number | boolean>
export type SdkQueryParams = Record<string, QueryValue>

export interface SdkEndpointCallOptions<TBody = unknown> {
  path?: SdkPathParams
  query?: SdkQueryParams
  body?: TBody
  headers?: Record<string, string>
  signal?: AbortSignal
}

export type SdkEndpointResult<T = unknown> = T | PaginatedResponse<T> | { data: T } | undefined

export type SdkEndpointMethod = <TResponse = unknown, TBody = unknown>(
  options?: SdkEndpointCallOptions<TBody>,
) => Promise<SdkEndpointResult<TResponse>>

export type SdkDomainClient = Record<string, SdkEndpointMethod>
export type SdkFullApiClient = Record<SdkEndpointDomain, SdkDomainClient>

const API_V1_PREFIX = '/api/v1'

function pathForTransport(config: AiprojClientConfig, apiPath: string): string {
  const normalizedBaseUrl = normalizeBaseUrl(config.baseUrl)
  if (normalizedBaseUrl.endsWith(API_V1_PREFIX) && apiPath.startsWith(API_V1_PREFIX)) {
    return apiPath.slice(API_V1_PREFIX.length) || '/'
  }
  return apiPath
}

export function applyPathParams(path: string, params: SdkPathParams = {}): string {
  return path.replace(/:(\w+)|\{(\w+)\}/g, (_match, colonName, braceName) => {
    const name = String(colonName ?? braceName)
    const value = params[name]
    if (value === undefined || value === null) {
      throw new Error(`@aiproj/sdk: missing path parameter ${name} for ${path}`)
    }
    return encodeURIComponent(String(value))
  })
}

function createEndpointMethod(
  config: AiprojClientConfig,
  entry: NormalizedSdkEndpointRegistryEntry,
): SdkEndpointMethod {
  return async <TResponse = unknown, TBody = unknown>(
    options: SdkEndpointCallOptions<TBody> = {},
  ): Promise<SdkEndpointResult<TResponse>> => {
    const apiPath = applyPathParams(entry.path, options.path)
    const requestPath = pathForTransport(config, apiPath)
    const requestOptions: RequestOptions = {
      method: entry.method,
      query: toQueryString(options.query ?? {}),
      body: options.body,
      headers: options.headers,
      signal: options.signal,
    }
    const res = await rawRequest(config, requestPath, requestOptions)
    if (!res.ok) throw await parseApiError(res)
    if (res.status === 204) return undefined
    return (await res.json()) as SdkEndpointResult<TResponse>
  }
}

export function createSdkDomainClient(
  config: AiprojClientConfig,
  entries: readonly NormalizedSdkEndpointRegistryEntry[],
  domain: SdkEndpointDomain,
): SdkDomainClient {
  return Object.fromEntries(
    entries
      .filter((entry) => entry.domain === domain && entry.supportStatus === 'covered')
      .map((entry) => [entry.exportName, createEndpointMethod(config, entry)]),
  )
}

export function createSdkFullApiClient(
  config: AiprojClientConfig,
  entries: readonly NormalizedSdkEndpointRegistryEntry[],
): SdkFullApiClient {
  return {
    identity: createSdkDomainClient(config, entries, 'identity'),
    organization: createSdkDomainClient(config, entries, 'organization'),
    planning: createSdkDomainClient(config, entries, 'planning'),
    'schedule-resource-risk': createSdkDomainClient(config, entries, 'schedule-resource-risk'),
    'collaboration-reporting': createSdkDomainClient(config, entries, 'collaboration-reporting'),
    'ai-compiler-integration': createSdkDomainClient(config, entries, 'ai-compiler-integration'),
  }
}
