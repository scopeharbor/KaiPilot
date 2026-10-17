'use client'

/**
 * 旧版全局日历路由同化承接页 (/next/calendar)
 * (v3-ui-next-batch3-global-convergence W3 任务 5.1 / spec「旧版全局日历路由同化与全域时间主轴直达契约」).
 *
 * 契约规范：
 * 1. 废除旧版无意义的孤立日历页面，无缝溶解入新轨时间主轴跨项目全域刻度档；
 * 2. 接收历史深链查询参数（如 month, project 等），自动附加 `tier=global-timeline`；
 * 3. 页面挂载后立即执行 `router.replace('/next?tier=global-timeline')` 平滑导流；
 * 4. 提供零死链兜底链接与暗黑仪器感导流提示。
 */

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight, Clock, Loader2 } from 'lucide-react'

function CalendarAssimilationContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const targetUrl = React.useMemo(() => {
    const params = new URLSearchParams(searchParams ? searchParams.toString() : '')
    params.set('tier', 'global-timeline')
    return `/next?${params.toString()}`
  }, [searchParams])

  React.useEffect(() => {
    try {
      router.replace(targetUrl)
    } catch {
      // 兼容非浏览器或测试环境
    }
  }, [router, targetUrl])

  return (
    <div
      data-calendar-assimilation-page
      data-target-url={targetUrl}
      className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center"
    >
      <div className="flex max-w-md flex-col items-center rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-8 shadow-xl">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--nx-workspace-bg)] border border-[var(--nx-border-hairline)] text-[var(--nx-space-cyan)]">
          <Clock className="h-6 w-6 animate-pulse" />
        </div>

        <h2 className="mt-4 text-base font-semibold text-[var(--nx-text-primary)]">
          日历视图已升级为「全域时间主轴」
        </h2>

        <p className="mt-2 text-xs text-[var(--nx-text-muted)] leading-relaxed">
          旧版孤立全局日历已收敛至新轨跨项目全域刻度档。正在为你平滑跳转...
        </p>

        <div className="mt-6 flex items-center gap-2 text-xs text-[var(--nx-space-cyan)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>正在转入全域主轴...</span>
        </div>

        <div className="mt-6 border-t border-[var(--nx-border-hairline)] pt-4 w-full">
          <Link
            href={targetUrl}
            data-assimilation-fallback-link
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--nx-text-secondary)] hover:text-[var(--nx-space-cyan)] transition-colors"
          >
            <span>若未自动跳转，点击此处直达</span>
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function CalendarPage() {
  return (
    <React.Suspense
      fallback={
        <div
          data-calendar-assimilation-loading
          className="flex min-h-[60vh] items-center justify-center text-xs text-[var(--nx-text-muted)]"
        >
          正在定位时间主轴刻度档...
        </div>
      }
    >
      <CalendarAssimilationContent />
    </React.Suspense>
  )
}
