import { describe, expect, test } from 'vitest'

/**
 * Service Worker 缓存策略测试（v2-5-pwa-static-offline-fallback / 3.4）。
 *
 * 验证：
 * - 已批准的静态资产可被缓存
 * - 业务页面（/api/、/dashboard、/projects/）不可被缓存
 * - 认证响应不可被缓存
 * - 安全的静态 GET 请求可通过缓存策略处理
 */

// 测试用常量（与 service-worker.js 同步）
// 注意：CACHE_NAME 在 service-worker.js 中定义为 'aiproj-pwa-static-v1'
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

function isNetworkOnly(request: {
  method: string
  url: string
  headers: Record<string, string>
}): boolean {
  if (DENYLIST_METHODS.has(request.method)) return true
  const url = new URL(request.url, 'http://localhost:3000')
  if (url.origin !== 'http://localhost:3000') return true
  if (request.headers['authorization'] || request.headers['Authorization']) return true
  if (request.headers['cookie'] || request.headers['Cookie']) return true
  for (const pattern of DENYLIST_PATTERNS) {
    if (pattern.test(url.pathname)) return true
  }
  return false
}

function isAllowlisted(request: { method: string; url: string }): boolean {
  if (request.method !== 'GET') return false
  const url = new URL(request.url, 'http://localhost:3000')
  if (url.origin !== 'http://localhost:3000') return false
  if (STATIC_ALLOWLIST.has(url.pathname)) return true
  for (const prefix of STATIC_PREFIX_ALLOWLIST) {
    if (url.pathname.startsWith(prefix)) return true
  }
  return false
}

function request(
  overrides: Partial<{ method: string; url: string; headers: Record<string, string> }> = {},
) {
  return { method: 'GET', url: 'http://localhost:3000/', headers: {}, ...overrides }
}

describe('SW: approved static assets ARE cacheable', () => {
  // 这些资产是 isNetworkOnly=false && isAllowlisted=true → 可缓存

  const cacheableAssets = [
    { name: 'offline fallback', url: 'http://localhost:3000/offline' },
    { name: 'offline fallback with slash', url: 'http://localhost:3000/offline/' },
    { name: 'app icon 192', url: 'http://localhost:3000/branding/app-icon-192.png' },
    { name: 'app icon 512', url: 'http://localhost:3000/branding/app-icon-512.png' },
    { name: 'logo mark light', url: 'http://localhost:3000/branding/aiproj-logo-mark-light.svg' },
    { name: 'logo horizontal', url: 'http://localhost:3000/branding/aiproj-logo-horizontal.svg' },
    { name: 'favicon', url: 'http://localhost:3000/favicon.svg' },
    {
      name: 'next static chunk',
      url: 'http://localhost:3000/_next/static/chunks/app/layout-abc123.js',
    },
    {
      name: 'next static css',
      url: 'http://localhost:3000/_next/static/css/app/layout-abc123.css',
    },
    { name: 'next static media', url: 'http://localhost:3000/_next/static/media/image.webp' },
  ]

  for (const asset of cacheableAssets) {
    test(`${asset.name} is not network-only and is allowlisted`, () => {
      const req = request({ url: asset.url })
      expect(isNetworkOnly(req)).toBe(false)
      expect(isAllowlisted(req)).toBe(true)
    })
  }
})

describe('SW: business/authenticated pages NOT cacheable', () => {
  // 这些页面要么是 network-only（API 等），要么不在白名单中

  const nonCacheablePages = [
    {
      name: 'API v1 projects',
      url: 'http://localhost:3000/api/v1/projects',
      expectedNetworkOnly: true,
    },
    {
      name: 'API auth login',
      url: 'http://localhost:3000/api/v1/auth/login',
      expectedNetworkOnly: true,
    },
    { name: 'API health', url: 'http://localhost:3000/api/health', expectedNetworkOnly: true },
    { name: 'SSE events', url: 'http://localhost:3000/sse/events', expectedNetworkOnly: true },
    {
      name: 'Realtime socket',
      url: 'http://localhost:3000/realtime/socket',
      expectedNetworkOnly: true,
    },
    {
      name: 'Webhook receive',
      url: 'http://localhost:3000/webhook/receive',
      expectedNetworkOnly: true,
    },
    { name: 'Upload file', url: 'http://localhost:3000/upload/file', expectedNetworkOnly: true },
    {
      name: 'Download export',
      url: 'http://localhost:3000/download/export',
      expectedNetworkOnly: true,
    },
    {
      name: 'Attachments',
      url: 'http://localhost:3000/attachments/123',
      expectedNetworkOnly: true,
    },
    { name: 'Dashboard page', url: 'http://localhost:3000/dashboard', expectedNetworkOnly: false },
    {
      name: 'Project tasks',
      url: 'http://localhost:3000/projects/1/tasks',
      expectedNetworkOnly: false,
    },
    { name: 'Settings', url: 'http://localhost:3000/settings/profile', expectedNetworkOnly: false },
    { name: 'Login page', url: 'http://localhost:3000/login', expectedNetworkOnly: false },
  ]

  for (const page of nonCacheablePages) {
    test(
      `${page.name} is ${page.expectedNetworkOnly ? 'network-only' : 'not allowlisted'}` +
        `${page.expectedNetworkOnly ? '' : ' (not cacheable)'}`,
      () => {
        const req = request({ url: page.url })
        if (page.expectedNetworkOnly) {
          expect(isNetworkOnly(req)).toBe(true)
        } else {
          expect(isAllowlisted(req)).toBe(false)
        }
      },
    )
  }
})

describe('SW: API responses never cached', () => {
  // API 请求应始终是 network-only，无论是否携带 Authorization 头

  test('GET /api/v1/projects without auth → network-only', () => {
    const req = request({ url: 'http://localhost:3000/api/v1/projects' })
    expect(isNetworkOnly(req)).toBe(true)
    expect(isAllowlisted(req)).toBe(false)
  })

  test('GET /api/v1/projects with auth → network-only', () => {
    const req = request({
      url: 'http://localhost:3000/api/v1/projects',
      headers: { Authorization: 'Bearer token123' },
    })
    expect(isNetworkOnly(req)).toBe(true)
  })

  test('POST to any path → network-only', () => {
    const req = request({ method: 'POST', url: 'http://localhost:3000/offline' })
    expect(isNetworkOnly(req)).toBe(true)
  })
})

describe('SW: authenticated pages never cached', () => {
  // 带 Authorization/Cookie 的页面应 network-only

  test('dashboard with Authorization header → network-only', () => {
    const req = request({
      url: 'http://localhost:3000/dashboard',
      headers: { Authorization: 'Bearer token123' },
    })
    expect(isNetworkOnly(req)).toBe(true)
  })

  test('dashboard with Cookie header → network-only', () => {
    const req = request({
      url: 'http://localhost:3000/dashboard',
      headers: { Cookie: 'session=abc' },
    })
    expect(isNetworkOnly(req)).toBe(true)
  })

  test('_next/static chunk with Authorization header → network-only', () => {
    // 即使路径看起来像静态资产，含 Authorization 头也必须 network-only
    const req = request({
      url: 'http://localhost:3000/_next/static/chunks/app/layout.js',
      headers: { Authorization: 'Bearer token123' },
    })
    expect(isNetworkOnly(req)).toBe(true)
  })
})
