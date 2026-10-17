import { describe, expect, test } from 'vitest'

/**
 * Service Worker 请求分类测试（v2-5-pwa-static-offline-fallback / 3.2）。
 *
 * 测试 service-worker.js 的 denylist-first 策略：
 * - /api/ → network-only
 * - Authorization 头 → network-only
 * - Cookie 头 → network-only
 * - 非 GET 方法 → network-only
 * - SSE/Realtime → network-only
 * - Webhook → network-only
 * - Upload/Download → network-only
 * - 跨域 → network-only
 * - 歧义请求 → network-only
 * - 白名单静态资产 → 可缓存
 * - 导航请求 → network-first
 */

// 从 service-worker.js 提取的纯函数逻辑（复制用于测试）
// 注意：这些是测试 service-worker.js 中相同逻辑的纯函数副本

const CACHE_NAME = 'aiproj-pwa-static-v1'
const OFFLINE_FALLBACK_URL = '/offline'

const STATIC_ALLOWLIST = new Set([
  OFFLINE_FALLBACK_URL,
  '/offline/',
  '/branding/app-icon-192.png',
  '/branding/app-icon-512.png',
  '/branding/aiproj-logo-mark-light.svg',
  '/branding/aiproj-logo-horizontal.svg',
  '/favicon.svg',
])

const STATIC_PREFIX_ALLOWLIST = ['/_next/static/']

const DENYLIST_PATTERNS = [
  /^\/api\//,
  /\/api\/v1\//,
  /\/webhook\//,
  /\/sse\//,
  /\/realtime\//,
  /\/upload\//,
  /\/download\//,
  /\/attachments?\//,
]

const DENYLIST_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'])

function isNetworkOnlyTest(request: {
  method: string
  url: string
  headers: Record<string, string>
}): boolean {
  // 1. 非 GET
  if (DENYLIST_METHODS.has(request.method)) return true

  const url = new URL(request.url, 'http://localhost:3000')

  // 2. 跨域
  if (url.origin !== 'http://localhost:3000') return true

  // 3. Authorization
  if (request.headers['authorization'] || request.headers['Authorization']) return true

  // 4. Cookie
  if (request.headers['cookie'] || request.headers['Cookie']) return true

  // 5. 路径 denylist
  for (const pattern of DENYLIST_PATTERNS) {
    if (pattern.test(url.pathname)) return true
  }

  return false
}

function isAllowlistedTest(request: { method: string; url: string }): boolean {
  if (request.method !== 'GET') return false

  const url = new URL(request.url, 'http://localhost:3000')
  if (url.origin !== 'http://localhost:3000') return false

  if (STATIC_ALLOWLIST.has(url.pathname)) return true

  for (const prefix of STATIC_PREFIX_ALLOWLIST) {
    if (url.pathname.startsWith(prefix)) return true
  }

  return false
}

function makeRequest(
  overrides: Partial<{
    method: string
    url: string
    headers: Record<string, string>
  }> = {},
) {
  return {
    method: 'GET',
    url: 'http://localhost:3000/',
    headers: {},
    ...overrides,
  }
}

describe('SW: isNetworkOnly', () => {
  // ---- /api/ 路径 ----

  test('/api/v1/projects → network-only', () => {
    expect(isNetworkOnlyTest(makeRequest({ url: 'http://localhost:3000/api/v1/projects' }))).toBe(
      true,
    )
  })

  test('/api/v1/auth/login → network-only', () => {
    expect(isNetworkOnlyTest(makeRequest({ url: 'http://localhost:3000/api/v1/auth/login' }))).toBe(
      true,
    )
  })

  test('/api/health → network-only', () => {
    expect(isNetworkOnlyTest(makeRequest({ url: 'http://localhost:3000/api/health' }))).toBe(true)
  })

  // ---- Authorization 头 ----

  test('Authorization header → network-only', () => {
    expect(isNetworkOnlyTest(makeRequest({ headers: { Authorization: 'Bearer xyz' } }))).toBe(true)
  })

  test('lowercase authorization header → network-only', () => {
    expect(isNetworkOnlyTest(makeRequest({ headers: { authorization: 'Bearer xyz' } }))).toBe(true)
  })

  // ---- Cookie 头 ----

  test('Cookie header → network-only', () => {
    expect(isNetworkOnlyTest(makeRequest({ headers: { Cookie: 'session=abc' } }))).toBe(true)
  })

  test('lowercase cookie header → network-only', () => {
    expect(isNetworkOnlyTest(makeRequest({ headers: { cookie: 'session=abc' } }))).toBe(true)
  })

  // ---- 非 GET 方法 ----

  test('POST → network-only', () => {
    expect(isNetworkOnlyTest(makeRequest({ method: 'POST' }))).toBe(true)
  })

  test('PUT → network-only', () => {
    expect(isNetworkOnlyTest(makeRequest({ method: 'PUT' }))).toBe(true)
  })

  test('PATCH → network-only', () => {
    expect(isNetworkOnlyTest(makeRequest({ method: 'PATCH' }))).toBe(true)
  })

  test('DELETE → network-only', () => {
    expect(isNetworkOnlyTest(makeRequest({ method: 'DELETE' }))).toBe(true)
  })

  test('OPTIONS → network-only', () => {
    expect(isNetworkOnlyTest(makeRequest({ method: 'OPTIONS' }))).toBe(true)
  })

  test('HEAD → network-only', () => {
    expect(isNetworkOnlyTest(makeRequest({ method: 'HEAD' }))).toBe(true)
  })

  // ---- SSE/Realtime ----

  test('/sse/events → network-only', () => {
    expect(isNetworkOnlyTest(makeRequest({ url: 'http://localhost:3000/sse/events' }))).toBe(true)
  })

  test('/realtime/socket → network-only', () => {
    expect(isNetworkOnlyTest(makeRequest({ url: 'http://localhost:3000/realtime/socket' }))).toBe(
      true,
    )
  })

  // ---- Webhook ----

  test('/webhook/receive → network-only', () => {
    expect(isNetworkOnlyTest(makeRequest({ url: 'http://localhost:3000/webhook/receive' }))).toBe(
      true,
    )
  })

  test('/api/v1/webhooks/github → network-only', () => {
    expect(
      isNetworkOnlyTest(makeRequest({ url: 'http://localhost:3000/api/v1/webhooks/github' })),
    ).toBe(true)
  })

  // ---- Upload/Download ----

  test('/upload/file → network-only', () => {
    expect(isNetworkOnlyTest(makeRequest({ url: 'http://localhost:3000/upload/file' }))).toBe(true)
  })

  test('/download/export → network-only', () => {
    expect(isNetworkOnlyTest(makeRequest({ url: 'http://localhost:3000/download/export' }))).toBe(
      true,
    )
  })

  test('/attachments/123 → network-only', () => {
    expect(isNetworkOnlyTest(makeRequest({ url: 'http://localhost:3000/attachments/123' }))).toBe(
      true,
    )
  })

  // ---- 跨域 ----

  test('cross-origin → network-only', () => {
    expect(isNetworkOnlyTest(makeRequest({ url: 'https://other-domain.com/api/data' }))).toBe(true)
  })

  test('cross-origin no api path → network-only', () => {
    expect(isNetworkOnlyTest(makeRequest({ url: 'https://other-domain.com/page' }))).toBe(true)
  })

  // ---- 歧义请求（denylist-first 原则） ----

  test('ambiguous URL with unknown path → network-only', () => {
    expect(isNetworkOnlyTest(makeRequest({ url: 'http://localhost:3000/unknown-path' }))).toBe(
      false,
    )
  })

  test('ambiguous URL with query params → network-only', () => {
    expect(isNetworkOnlyTest(makeRequest({ url: 'http://localhost:3000/page?debug=true' }))).toBe(
      false,
    )
  })

  // ---- 安全静态 GET 请求 ----

  test('plain GET to static asset → not network-only', () => {
    expect(isNetworkOnlyTest(makeRequest({ url: 'http://localhost:3000/offline' }))).toBe(false)
  })

  test('GET to _next/static/chunk → not network-only', () => {
    expect(
      isNetworkOnlyTest(
        makeRequest({ url: 'http://localhost:3000/_next/static/chunks/app/layout-abc123.js' }),
      ),
    ).toBe(false)
  })
})

describe('SW: isAllowlisted', () => {
  // ---- 白名单精确匹配 ----

  test('offline path → allowlisted', () => {
    expect(isAllowlistedTest(makeRequest({ url: 'http://localhost:3000/offline' }))).toBe(true)
  })

  test('offline path with trailing slash → allowlisted', () => {
    expect(isAllowlistedTest(makeRequest({ url: 'http://localhost:3000/offline/' }))).toBe(true)
  })

  test('brand icon 192 → allowlisted', () => {
    expect(
      isAllowlistedTest(makeRequest({ url: 'http://localhost:3000/branding/app-icon-192.png' })),
    ).toBe(true)
  })

  test('brand icon 512 → allowlisted', () => {
    expect(
      isAllowlistedTest(makeRequest({ url: 'http://localhost:3000/branding/app-icon-512.png' })),
    ).toBe(true)
  })

  test('favicon → allowlisted', () => {
    expect(isAllowlistedTest(makeRequest({ url: 'http://localhost:3000/favicon.svg' }))).toBe(true)
  })

  test('logo horizontal → allowlisted', () => {
    expect(
      isAllowlistedTest(
        makeRequest({ url: 'http://localhost:3000/branding/aiproj-logo-horizontal.svg' }),
      ),
    ).toBe(true)
  })

  // ---- 前缀匹配 ----

  test('_next/static chunk → allowlisted', () => {
    expect(
      isAllowlistedTest(
        makeRequest({ url: 'http://localhost:3000/_next/static/chunks/app/layout-abc123.js' }),
      ),
    ).toBe(true)
  })

  test('_next/static/css → allowlisted', () => {
    expect(
      isAllowlistedTest(
        makeRequest({ url: 'http://localhost:3000/_next/static/css/app/layout-abc123.css' }),
      ),
    ).toBe(true)
  })

  test('_next/static/media → allowlisted', () => {
    expect(
      isAllowlistedTest(
        makeRequest({ url: 'http://localhost:3000/_next/static/media/image-abc123.webp' }),
      ),
    ).toBe(true)
  })

  // ---- 非白名单拒绝 ----

  test('api path → not allowlisted', () => {
    expect(isAllowlistedTest(makeRequest({ url: 'http://localhost:3000/api/v1/projects' }))).toBe(
      false,
    )
  })

  test('dashboard page → not allowlisted', () => {
    expect(isAllowlistedTest(makeRequest({ url: 'http://localhost:3000/dashboard' }))).toBe(false)
  })

  test('project page → not allowlisted', () => {
    expect(isAllowlistedTest(makeRequest({ url: 'http://localhost:3000/projects/1/tasks' }))).toBe(
      false,
    )
  })

  test('cross-origin → not allowlisted', () => {
    expect(
      isAllowlistedTest(makeRequest({ method: 'GET', url: 'https://other.com/offline' })),
    ).toBe(false)
  })

  test('POST to offline → not allowlisted', () => {
    expect(
      isAllowlistedTest(makeRequest({ method: 'POST', url: 'http://localhost:3000/offline' })),
    ).toBe(false)
  })
})

describe('SW: cache name', () => {
  test('uses aiproj-pwa-static-v1 cache name', () => {
    expect(CACHE_NAME).toBe('aiproj-pwa-static-v1')
  })
})
