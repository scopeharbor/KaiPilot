'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

/**
 * 旧版全域搜索路由同化页（/next/search?q=...，v3-ui-next-batch3-global-convergence W1 · tasks 5.1 & spec）。
 *
 * 核心契约：
 * 1. 新轨收敛独立搜索大页，将全域搜索能力溶解融入空间地图 Overlay（Ctrl+M）；
 * 2. 访问本页自动提取 URL 查询参数（?q= 或 ?keyword=）；
 * 3. 路由平滑重定向（router.replace('/next')），避免历史记录死循环与 404 死链；
 * 4. 自动唤起空间地图 Overlay 并预填关键词，即刻触发跨实体检索展示。
 */
function SearchAssimilationContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const query = searchParams?.get('q') || searchParams?.get('keyword') || ''

  React.useEffect(() => {
    // 1. 若有关键词，暂存至 sessionStorage 供空间地图 Overlay 挂载时消费
    if (query && typeof window !== 'undefined' && window.sessionStorage) {
      try {
        window.sessionStorage.setItem('space-map-prefill', query)
      } catch {
        // 忽略存储异常
      }
    }

    // 2. 立即平滑替换路由至角色工作台首页
    router.replace('/next')

    // 3. 同时派发自定义唤起事件，确保已有主壳体即刻响应
    const timer = setTimeout(() => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('space-map-trigger', {
            detail: { query, lens: 'spaces' },
          }),
        )
      }
    }, 50)

    return () => clearTimeout(timer)
  }, [router, query])

  return (
    <div
      data-testid="search-assimilation-page"
      role="status"
      className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-center text-xs text-[var(--nx-text-muted)]"
    >
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--nx-space-cyan)] border-t-transparent" />
      <p>正在转入空间地图全域检索枢纽…</p>
    </div>
  )
}

export default function SearchAssimilationPage() {
  return (
    <React.Suspense fallback={null}>
      <SearchAssimilationContent />
    </React.Suspense>
  )
}
