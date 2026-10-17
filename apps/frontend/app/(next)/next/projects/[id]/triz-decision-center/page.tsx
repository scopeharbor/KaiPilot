'use client'

import * as React from 'react'
import { Suspense } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { ProjectSpaceNotFoundView } from '@/components/next/project-space/ProjectSpaceContainer'
import TrizDecisionCenterPage from '@/app/(dashboard)/projects/[id]/triz-decision-center/page'

/**
 * TRIZ 决策中心新轨路由（/next/projects/:id/triz-decision-center）。
 *
 * **刻意跨轨复用**：直接挂载旧轨生产页（含交付闭环面板 DeliveryLoopPanel）。
 * 决策中心是 1200+ 行的完整生产功能（队列/详情抽屉/动作对话框/就绪面板/交付闭环），
 * 功能补齐优先于视觉重绘；重绘另立专项。旧轨页面零改动。
 *
 * - 页守卫 `triz_decision:view`（无权渲染受限横幅，零数据请求——RL-06 防探测）；
 * - 路径 id 非数字 → 中性 404 空态，零网络请求（RL-05）。
 */
export default function TrizDecisionCenterNextPage() {
  return (
    <Suspense
      fallback={
        <div
          data-triz-center-loading
          className="rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-10 text-center text-xs text-[var(--nx-text-muted)]"
        >
          正在载入 TRIZ 决策中心…
        </div>
      }
    >
      <TrizDecisionCenterNextInner />
    </Suspense>
  )
}

function TrizDecisionCenterNextInner() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const projectId = Number(params?.id)
  const validId = Number.isInteger(projectId) && projectId > 0

  return (
    <PermissionGuard
      require={['project:view', 'triz_decision:view']}
      fallback={
        <div
          data-permission-fallback
          className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-8 text-center"
        >
          <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-[var(--nx-status-warning)]" />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            你没有查看 TRIZ 决策中心的权限
          </h3>
          <p className="mt-1 text-xs text-[var(--nx-text-muted)]">
            请联系组织管理员或项目负责人授予 project:view 与 triz_decision:view 权限。
          </p>
        </div>
      }
    >
      {validId ? (
        <div data-triz-center-next-page>
          <TrizDecisionCenterPage />
        </div>
      ) : (
        <ProjectSpaceNotFoundView onBackHome={() => router.push('/next')} />
      )}
    </PermissionGuard>
  )
}
