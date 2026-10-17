'use client'

/**
 * 旧版全局报表路由同化承接页 (/next/reports)
 * (v3-ui-next-batch4-reports-change-queue W5 · tasks 5.1 / design Decision 5)
 *
 * 契约规范：
 * 1. 废除旧版无意义的全局项目卡片列表，双向溶解至新轨：
 *    - 默认平滑重定向至图表馆组织级分馆 (/next/charts?tab=reports-wing)；
 *    - 若带有 ?view=pmo 重定向至 PMO 组合报表镜头 (/next/pmo/reports)；
 *    - 若携带 ?projectId= 参数智能定向至单项目空间 (/next/projects/:id/reports)；
 * 2. 页面挂载后立即执行 router.replace 平滑导流；
 * 3. 提供零死链兜底链接与暗黑仪器感导流提示。
 */

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight, BarChart3, Loader2 } from 'lucide-react'

function ReportsAssimilationContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const targetUrl = React.useMemo(() => {
    const params = new URLSearchParams(searchParams ? searchParams.toString() : '')
    const projectId = params.get('projectId')
    if (projectId) {
      params.delete('projectId')
      const qs = params.toString()
      return `/next/projects/${projectId}/reports${qs ? `?${qs}` : ''}`
    }

    const view = params.get('view')
    if (view === 'pmo') {
      params.delete('view')
      const qs = params.toString()
      return `/next/pmo/reports${qs ? `?${qs}` : ''}`
    }

    params.set('tab', 'reports-wing')
    return `/next/charts?${params.toString()}`
  }, [searchParams])

  React.useEffect(() => {
    try {
      router.replace(targetUrl)
    } catch {
      // 兼容测试或非浏览器环境
    }
  }, [router, targetUrl])

  return (
    <div
      data-reports-assimilation-page
      data-target-url={targetUrl}
      className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center"
    >
      <div className="flex max-w-md flex-col items-center rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-8 shadow-xl">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] text-[var(--nx-space-cyan)]">
          <BarChart3 className="h-6 w-6 animate-pulse" />
        </div>

        <h2 className="mt-4 text-base font-semibold text-[var(--nx-text-primary)]">
          全局报表已溶解至新轨
        </h2>

        <p className="mt-2 text-xs leading-relaxed text-[var(--nx-text-muted)]">
          旧版全局报表已升级为图表馆组织报表分馆与 PMO 组合报表大盘。正在为你平滑跳转...
        </p>

        <div className="mt-6 flex items-center gap-2 text-xs text-[var(--nx-space-cyan)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>正在转入新轨报表视图...</span>
        </div>

        <div className="mt-6 w-full border-t border-[var(--nx-border-hairline)] pt-4">
          <Link
            href={targetUrl}
            data-assimilation-fallback-link
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-space-cyan)]"
          >
            <span>若未自动跳转，点击此处直达</span>
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function ReportsPage() {
  return (
    <React.Suspense
      fallback={
        <div
          data-reports-assimilation-loading
          className="flex min-h-[60vh] items-center justify-center text-xs text-[var(--nx-text-muted)]"
        >
          正在定位报表镜头...
        </div>
      }
    >
      <ReportsAssimilationContent />
    </React.Suspense>
  )
}
