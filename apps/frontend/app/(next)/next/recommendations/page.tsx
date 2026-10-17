'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'

/**
 * 智能推荐路由同化页（/next/recommendations，v3-ui-next-batch3-global-convergence W4/W5 · tasks 5.1）。
 *
 * 依据设计哲学，智能推荐能力已全面溶解进角色首页业务化建议卡槽与 AI 同事主动雷达，
 * 访问时自动平滑重定向至角色首页建议卡槽区域。
 */
export default function NextRecommendationsAssimilationPage() {
  const router = useRouter()

  React.useEffect(() => {
    router.replace('/next')
  }, [router])

  return (
    <div
      data-next-recommendations-assimilation
      className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center p-6"
    >
      <Sparkles className="h-8 w-8 text-[var(--nx-accent)] animate-pulse" aria-hidden />
      <h3 className="text-base font-medium text-[var(--nx-text-primary)]">正在导航至建议卡槽…</h3>
      <p className="text-xs text-[var(--nx-text-muted)] font-mono">REDIRECT · /next</p>
    </div>
  )
}
