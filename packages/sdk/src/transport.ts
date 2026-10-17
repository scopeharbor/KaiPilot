// v2-5-typescript-sdk-core —— 纯 transport core（design D2）。
//
// 可注入 fetch/token/baseUrl/organization context；不导入前端 store、Next.js、
// AdonisJS 运行态或浏览器专属全局（fetch 仅在注入或全局可用时使用）。
// envelope 语义与 apps/frontend/lib/api-client.ts 一致：列表返回 { data, meta }、
// 单资源返回 T（解包 .data）、204 返回 undefined。

import type { ApiErrorResponse, PaginationMeta } from '@aiproj/types'
import { parseApiError } from './errors.js'

/** SDK 不绑定任何前端/后端运行态；fetch 通过类型注入。 */
export type SdkFetch = typeof fetch

/** 同步或异步的 access token 提供者。 */
export type TokenProvider = () => string | null | undefined | Promise<string | null | undefined>

/** 同步或异步的组织上下文提供者（注入 X-Organization-Id）。 */
export type OrganizationContextProvider = () =>
  number | null | undefined | Promise<number | null | undefined>

export interface AiprojClientConfig {
  /** API 基础地址，须指向 /api/v1。 */
  baseUrl: string
  /** 可注入的 fetch（测试用 fixture；生产用全局 fetch）。 */
  fetch?: SdkFetch
  /** access token 提供者。 */
  tokenProvider?: TokenProvider
  /** 组织上下文提供者，注入 X-Organization-Id 头。 */
  organizationContextProvider?: OrganizationContextProvider
  /** 额外静态请求头。 */
  defaultHeaders?: Record<string, string>
  /** User-Agent 元数据（Node 环境默认带）。 */
  userAgent?: string
}

/** SDK 请求选项。 */
export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  /** 以 ? 开头的查询串，由 client 模块用 toQueryString 构造。 */
  query?: string
  /** JSON 可序列化的请求体。 */
  body?: unknown
  /** 额外请求头。 */
  headers?: Record<string, string>
  /** signal 透传。 */
  signal?: AbortSignal
}

/** 规范化 baseUrl：去除尾斜杠；缺失 /api/v1 时不强制（由调用方保证）。 */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

/** 拼接 baseUrl 与 path（path 须以 / 开头）。 */
export function joinUrl(baseUrl: string, path: string, query = ''): string {
  const base = normalizeBaseUrl(baseUrl)
  const p = path.startsWith('/') ? path : `/${path}`
  return `${base}${p}${query}`
}

/** 构造请求头：注入 Content-Type、Authorization、X-Organization-Id、defaultHeaders。 */
async function buildHeaders(
  config: AiprojClientConfig,
  init: RequestOptions,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...config.defaultHeaders }
  if (config.userAgent) headers['user-agent'] = config.userAgent
  if (init.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  if (config.tokenProvider) {
    const token = await config.tokenProvider()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }
  if (config.organizationContextProvider) {
    const orgId = await config.organizationContextProvider()
    if (orgId !== undefined && orgId !== null) {
      headers['X-Organization-Id'] = String(orgId)
    }
  }
  if (init.headers) Object.assign(headers, init.headers)
  return headers
}

export interface TransportResult {
  res: Response
}

/** 执行一次 HTTP 请求，返回原始 Response（由调用方决定解包方式）。 */
export async function rawRequest(
  config: AiprojClientConfig,
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  const fetchImpl = config.fetch ?? (globalThis.fetch as SdkFetch | undefined)
  if (!fetchImpl) {
    throw new Error('@aiproj/sdk: no fetch implementation available; inject config.fetch')
  }
  const url = joinUrl(config.baseUrl, path, options.query ?? '')
  const headers = await buildHeaders(config, options)
  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
    signal: options.signal,
  }
  if (options.body !== undefined) init.body = JSON.stringify(options.body)
  return fetchImpl(url, init)
}

/** GET 列表：返回 { data, meta } envelope（不解包）。失败抛 ApiErrorResponse。 */
export async function requestList<T>(
  config: AiprojClientConfig,
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T[]; meta: PaginationMeta }> {
  const res = await rawRequest(config, path, { ...options, method: options.method ?? 'GET' })
  if (!res.ok) throw await parseApiError(res)
  if (res.status === 204)
    return { data: [], meta: { total: 0, page: 1, perPage: 0, totalPages: 0 } }
  const body = (await res.json()) as { data: T[]; meta: PaginationMeta }
  return body
}

/** 单资源请求：解包 .data；204 返回 undefined。失败抛 ApiErrorResponse。 */
export async function requestResource<T>(
  config: AiprojClientConfig,
  path: string,
  options: RequestOptions = {},
): Promise<T | undefined> {
  const res = await rawRequest(config, path, { ...options, method: options.method ?? 'GET' })
  if (!res.ok) throw await parseApiError(res)
  if (res.status === 204) return undefined
  const body = (await res.json()) as { data: T }
  return body.data
}

export type { ApiErrorResponse }
