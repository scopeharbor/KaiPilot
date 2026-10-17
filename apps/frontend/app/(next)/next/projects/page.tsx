'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { SpaceMapOverlay } from '@/components/next/navigation/SpaceMapOverlay'

/**
 * 新轨项目列表入口（v3-ui-next-batch1-strategy-launch-tasks W2 任务 2.7 / spec「next-spatial-map-list-lens」）。
 *
 * 落实 D10 菜单极薄化设计哲学，淘汰独立旧版项目列表页。
 * 外部深链或书签访问本路由时，组件挂载后定向激活空间地图清单镜头（defaultLens="projects"），
 * 向用户呈现完整的项目高密度表格；关闭浮层后平滑切回新轨主页 `/next`。
 */
export default function NextProjectsPage() {
  const router = useRouter()
  const [open, setOpen] = React.useState(true)

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen)
      if (!nextOpen) {
        router.push('/next')
      }
    },
    [router],
  )

  return (
    <main
      data-testid="next-projects-page"
      data-next-projects-page=""
      className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-12"
    >
      <SpaceMapOverlay open={open} defaultLens="projects" onOpenChange={handleOpenChange} />
      <div className="flex flex-col items-center gap-2 text-center text-xs text-[var(--nx-text-muted)]">
        <p className="text-sm font-medium text-[var(--nx-text-primary)]">
          开项 OpenXiang · 项目清单
        </p>
        <p>
          已定向唤起空间地图清单镜头。若浮层未弹出，请按{' '}
          <kbd className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--nx-text-secondary)]">
            Ctrl+M
          </kbd>{' '}
          重新呼出。
        </p>
      </div>
    </main>
  )
}
