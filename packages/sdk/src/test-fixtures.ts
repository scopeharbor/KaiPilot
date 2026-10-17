// v2-5-typescript-sdk-core 测试夹具 —— 可注入的 mock fetch，记录调用、按规则返回。
// 默认不发起真实网络请求（design Non-Goals：不做真实外部请求 smoke）。

export interface RecordedCall {
  url: string
  init: RequestInit
}

export interface MockResponseRule {
  /** 匹配 URL（含 query）或 URL 子串。 */
  match?: string | RegExp
  method?: string
  status?: number
  /** JSON 响应体。 */
  body?: unknown
  /** 非 JSON 纯文本（用于 malformed 测试）。 */
  text?: string
  statusText?: string
}

export interface MockFetchOptions {
  rules?: MockResponseRule[]
  /** 无规则命中时的默认响应。 */
  fallback?: MockResponseRule
}

export function createMockFetch(options: MockFetchOptions = {}) {
  const calls: RecordedCall[] = []
  const fetchImpl = async (url: string | URL | Request, init: RequestInit = {}) => {
    const urlString = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
    calls.push({ url: urlString, init })
    const rules = [...(options.rules ?? []), options.fallback].filter(
      (r): r is MockResponseRule => r !== undefined,
    )
    const method = (init.method ?? 'GET').toUpperCase()
    const rule = rules.find((r) => {
      if (r.method && r.method.toUpperCase() !== method) return false
      if (r.match !== undefined) {
        if (typeof r.match === 'string') return urlString.includes(r.match)
        return r.match.test(urlString)
      }
      return true
    })
    if (!rule) {
      throw new Error(`mock fetch: no rule matched ${method} ${urlString}`)
    }
    const status = rule.status ?? 200
    const statusText = rule.statusText ?? ''
    const headers = new Headers()
    if (rule.body !== undefined) headers.set('Content-Type', 'application/json')
    const bodyText = rule.body !== undefined ? JSON.stringify(rule.body) : (rule.text ?? null)
    return new Response(bodyText, { status, statusText, headers })
  }
  return { fetch: fetchImpl as typeof fetch, calls }
}

/** 构造一个返回 envelope body 的默认规则。 */
export function okEnvelope(body: unknown, status = 200): MockResponseRule {
  return { status, body }
}
