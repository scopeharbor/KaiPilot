// BI 报表模块（v3-bi-custom-report-builder / v3-bi-report-template-library）共用的
// 轻量请求外壳。这两个 client 是按 ky 风格写的（`api.get(url).json<T>().then(unwrap)`
// 与 `api.post(url, body)`），但仓库并没有 ky，模块也从未落地，导致构建期
// module-not-found。此处按既有调用形态在 apiFetchEnvelope 之上补齐，
// 保持认证 / 401 静默刷新 / API_BASE_URL 前缀等既有行为一致。

import { apiFetchEnvelope } from '@/lib/api-client'

/** 既是 Promise，又支持 ky 风格的 `.json<T>()` 断言。 */
export interface ApiRequest<T> extends Promise<T> {
  json<R>(): Promise<R>
}

type BodyArg = unknown | { json: unknown }

function extractBody(arg?: BodyArg): unknown {
  if (arg === undefined) return undefined
  if (arg !== null && typeof arg === 'object' && 'json' in (arg as Record<string, unknown>)) {
    return (arg as { json: unknown }).json
  }
  return arg
}

function request<T>(method: string, path: string, arg?: BodyArg): ApiRequest<T> {
  const body = extractBody(arg)
  const init: RequestInit = {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
  const promise = apiFetchEnvelope<T>(path, init) as ApiRequest<T>
  // `.json<R>()` 只做类型断言：响应体已由 apiFetchEnvelope 解析完毕。
  promise.json = <R>() => promise as unknown as Promise<R>
  return promise
}

export const api = {
  get: <T = unknown>(path: string) => request<T>('GET', path),
  post: <T = unknown>(path: string, body?: BodyArg) => request<T>('POST', path, body),
  put: <T = unknown>(path: string, body?: BodyArg) => request<T>('PUT', path, body),
  patch: <T = unknown>(path: string, body?: BodyArg) => request<T>('PATCH', path, body),
  delete: <T = unknown>(path: string) => request<T>('DELETE', path),
}

/**
 * 直通返回。调用方写的是 `.then(unwrap)`，但各函数声明的返回类型本身就是
 * `{ data, meta }` 完整信封，且 apiFetchEnvelope 已经解析过响应体，
 * 故这里不再剥一层 `data`——剥掉会丢失 `meta`。
 */
export function unwrap<T>(response: T): T {
  return response
}
