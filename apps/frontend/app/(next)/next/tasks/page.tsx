'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CheckSquare } from 'lucide-react'

/**
 * 全局任务路由同化页（/next/tasks，v3-ui-next-batch3-global-convergence W4/W5 · tasks 5.1）。
 *
 * 依据 D10 与 D13 导航升维与能力溶解哲学，全局任务不再独立成孤立大页，
 * 访问时自动同化重定向至角色首页并激活跨项目任务高密度 HUD 镜头。
 */
export default function NextTasksAssimilationPage() {
  const router = useRouter()

  React.useEffect(() => {
    router.replace('/next?focus=tasks-hud')
  }, [router])

  return (
    <div
      data-next-tasks-assimilation
      className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center p-6"
    >
      <CheckSquare className="h-8 w-8 text-[var(--nx-accent)] animate-pulse" aria-hidden />
      <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
        正在唤起跨项目任务 HUD 镜头…
      </h3>
      <p className="text-xs text-[var(--nx-text-muted)] font-mono">
        REDIRECT · /next?focus=tasks-hud
      </p>
    </div>
  )
}
