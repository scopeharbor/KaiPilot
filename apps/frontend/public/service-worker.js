/* global Request, URL, self, caches, fetch, Response */

/**
 * aiproj PWA 离线 Fallback 服务工作者（Service Worker）。
 *
 * 策略：
 * - 仅缓存低敏静态资产（离线 fallback 页面 + 已批准的壳资产）
 * - 敏感请求（/api/、Authorization、非 GET、SSE、Webhook、上传/下载、跨域）→ network-only
 * - 导航请求 → network-first，网络失败时 fallback 到离线页面
 * - 歧义请求 → network-only（denylist-first 原则）
 *
 * 缓存命名约定：aiproj-pwa-static-v1
 *
 * @see design.md D1-D3 / spec pwa-static-offline-fallback
 */

const CACHE_NAME = 'aiproj-pwa-static-v1'
const OFFLINE_FALLBACK_URL = '/offline'

/** 允许缓存的低敏静态资产白名单（仅限同源 GET 请求）。 */
const STATIC_ALLOWLIST = new Set([
  OFFLINE_FALLBACK_URL,
  '/offline/',
  '/branding/app-icon-192.png',
  '/branding/app-icon-512.png',
  '/branding/aiproj-logo-mark-light.svg',
  '/branding/aiproj-logo-horizontal.svg',
  '/favicon.svg',
])

/** 允许缓存的前缀模式（用于 _next/static/ 等哈希资产）。 */
const STATIC_PREFIX_ALLOWLIST = ['/_next/static/']

/** Denylist：匹配这些模式的请求必须是 network-only。 */
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

/** Denylist HTTP 方法：非 GET 请求 network-only。 */
const DENYLIST_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'])

/**
 * 判断请求是否应走 network-only（denylist-first 原则）。
 *
 * @returns true = 必须 network-only，不读/写缓存
 */
function isNetworkOnly(request) {
  // 1. 非 GET → network-only
  if (DENYLIST_METHODS.has(request.method)) return true

  const url = new URL(request.url)

  // 2. 跨域 → network-only
  if (url.origin !== self.location.origin) return true

  // 3. Authorization 头 → network-only
  if (request.headers.has('Authorization')) return true

  // 4. Cookie 头 → network-only（含认证 cookie）
  if (request.headers.has('Cookie')) return true

  // 5. 路径匹配 denylist → network-only
  for (const pattern of DENYLIST_PATTERNS) {
    if (pattern.test(url.pathname)) return true
  }

  return false
}

/**
 * 判断请求是否属于允许缓存的静态资产白名单。
 */
function isAllowlisted(request) {
  if (request.method !== 'GET') return false

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return false

  // 精确路径匹配
  if (STATIC_ALLOWLIST.has(url.pathname)) return true

  // 前缀匹配（_next/static/ 等）
  for (const prefix of STATIC_PREFIX_ALLOWLIST) {
    if (url.pathname.startsWith(prefix)) return true
  }

  return false
}

/**
 * 判断请求是否为导航请求（HTML 页面）。
 */
function isNavigationRequest(request) {
  return (
    request.mode === 'navigate' ||
    (request.method === 'GET' && request.headers.get('Accept')?.includes('text/html') === true)
  )
}

// ========== 安装事件：预缓存离线 fallback ==========

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      // 只预缓存离线 fallback 页面
      await cache.add(new Request(OFFLINE_FALLBACK_URL, { cache: 'reload' }))
    })(),
  )
  // 跳过等待，立即激活
  self.skipWaiting()
})

// ========== 激活事件：清理旧缓存 ==========

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 清理不属于当前版本的 aiproj-pwa-* 缓存
      const cacheKeys = await caches.keys()
      const oldCaches = cacheKeys.filter(
        (key) => key.startsWith('aiproj-pwa-') && key !== CACHE_NAME,
      )
      await Promise.all(oldCaches.map((key) => caches.delete(key)))
      // 立即控制所有客户端
      await self.clients.claim()
    })(),
  )
})

// ========== 推送事件：处理 Web Push 通知 ==========

self.addEventListener('push', (event) => {
  /** @type {{ title?: string, body?: string, data?: { route?: string, notificationId?: number } } | null} */
  let payload = null

  try {
    if (event.data) {
      payload = event.data.json()
    }
  } catch {
    // 解析失败时忽略，使用默认通知
  }

  const title = payload?.title ?? '开项 OpenXiang'
  const options = {
    body: payload?.body ?? '有新通知',
    icon: '/branding/app-icon-192.png',
    badge: '/branding/app-icon-192.png',
    data: {
      route: payload?.data?.route ?? '/notifications',
      notificationId: payload?.data?.notificationId,
    },
    // 不写缓存、不存 IndexedDB、不触业务 API
    tag: 'aiproj-push-notification',
    renotify: true,
    requireInteraction: false,
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

// ========== 通知点击事件 ==========

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const route = event.notification.data?.route ?? '/notifications'
  const notificationId = event.notification.data?.notificationId

  // 只允许同源安全路由
  const safeRoutes = ['/notifications', '/projects', '/dashboard', '/settings']
  const isSafe = safeRoutes.some(
    (safeRoute) => route === safeRoute || route.startsWith(safeRoute + '/'),
  )

  const targetUrl = isSafe ? route : '/notifications'

  // 添加 notificationId 参数以便页面打开时定位
  const url = notificationId ? `${targetUrl}?pushNotificationId=${notificationId}` : targetUrl

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 如果已有打开的页面，聚焦并导航
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.focus()
          client.navigate(url)
          return
        }
      }
      // 没有打开页面时打开新窗口
      self.clients.openWindow(url)
    }),
  )
})

// ========== 拦截事件：请求处理 ==========

self.addEventListener('fetch', (event) => {
  const request = event.request

  // 1. Denylist-first：敏感请求直接走网络
  if (isNetworkOnly(request)) {
    event.respondWith(fetch(request))
    return
  }

  // 2. 导航请求：network-first，失败 fallback 到离线页面
  if (isNavigationRequest(request)) {
    event.respondWith(networkFirstWithFallback(request))
    return
  }

  // 3. 静态资产白名单：缓存优先
  if (isAllowlisted(request)) {
    event.respondWith(cacheFirstWithNetworkUpdate(request))
    return
  }

  // 4. 其他请求：走网络（歧义请求 = network-only per D3）
  event.respondWith(fetch(request))
})

/**
 * Network-first 策略：优先走网络，失败时从缓存返回离线 fallback。
 * 用于导航请求（HTML 页面）。
 */
async function networkFirstWithFallback(request) {
  try {
    const response = await fetch(request)
    // 只缓存成功的导航响应（HTML）
    if (response.ok || response.type === 'opaqueredirect') {
      return response
    }
    // 非成功响应也返回，但不缓存
    return response
  } catch {
    // 网络失败：返回缓存的离线 fallback
    const cache = await caches.open(CACHE_NAME)
    const cachedResponse = await cache.match(OFFLINE_FALLBACK_URL)
    if (cachedResponse) {
      return cachedResponse
    }
    // 离线 fallback 不在缓存中时返回简单的离线响应
    return new Response(
      '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>离线</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f9fafb;color:#111827;text-align:center;padding:1rem}h1{font-size:1.5rem;margin-bottom:0.5rem}p{color:#6b7280}a{color:#4338CA;text-decoration:underline}</style></head><body><div><h1>离线</h1><p>网络连接已断开</p><a href="/dashboard">重试连接</a></div></body></html>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }
}

/**
 * Cache-first 策略：优先返回缓存，后台更新缓存。
 * 用于静态资产白名单请求。
 */
async function cacheFirstWithNetworkUpdate(request) {
  const cache = await caches.open(CACHE_NAME)
  const cachedResponse = await cache.match(request)

  // 后台异步更新缓存
  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        // 克隆响应以同时用于缓存和返回
        const clonedResponse = response.clone()
        cache.put(request, clonedResponse)
      }
      return response
    })
    .catch(() => {
      // 网络失败时忽略（已有缓存或后续 fallback）
      return null
    })

  // 有缓存时立即返回，无缓存时等待网络
  if (cachedResponse) {
    // 不阻塞响应返回
    return cachedResponse
  }

  const networkResponse = await networkPromise
  if (networkResponse) {
    return networkResponse
  }

  // 既无缓存也无网络：返回离线 fallback
  const fallback = await cache.match(OFFLINE_FALLBACK_URL)
  if (fallback) return fallback

  return new Response('Offline', { status: 503 })
}
