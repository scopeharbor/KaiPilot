// v2-5-typescript-sdk-core —— API 错误解析。
//
// 解析 `{ error: { code, message, details? } }` envelope；非 JSON 响应回退到
// statusText；不携带原始 body/headers/cookie，仅保留低敏感的 status/code/message/details。
// 与 apps/frontend/lib/api-client.ts 的 toApiError 语义对齐。

import type { ApiErrorResponse } from '@aiproj/types'

/** 解析 Response 为低敏感 ApiErrorResponse（脱敏）。 */
export async function parseApiError(res: Response): Promise<ApiErrorResponse> {
  let code = 'UNKNOWN'
  let message = res.statusText || `HTTP ${res.status}`
  let details: unknown
  try {
    const body = await res.json()
    const err = body?.error
    if (err && typeof err === 'object') {
      if (typeof err.code === 'string') code = err.code
      if (typeof err.message === 'string') message = err.message
      if (err.details !== undefined) details = err.details
    } else if (typeof body === 'string' && body) {
      // 非 envelope 的纯文本错误体，仅取其作为 message，不暴露 body 字段。
      message = body
    }
  } catch {
    // 非 JSON 响应：保留默认 statusText。
  }
  return { status: res.status, code, message, details }
}
