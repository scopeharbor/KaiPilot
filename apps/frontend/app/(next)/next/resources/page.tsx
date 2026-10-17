'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { GlobalResourcesHub } from '@/components/next/org-resources-global/GlobalResourcesHub'

/**
 * 全局资源入口页面（/next/resources，v3-ui-next-org-portfolio-domains W7 ·
 * tasks 7.8，spec「全局资源入口、技能矩阵与问题风险入口」）。
 *
 * - 页面准入（design Decision 7 / RBAC 矩阵）：`org:view` / `resource:view` /
 *   `portfolio:view` 任一即可——无权限渲染受限横幅且底层接口零请求（RL-06）；
 * - URL `?projectId=` 由 Hub 记忆与恢复（显式选择，**不默认选中首个项目**——
 *   旧轨隐式语义缺陷不回迁）；项目级资源数据由后端逐项目授权；
 * - useSearchParams 以 <Suspense> 包裹，兼容 App Router 静态预渲染边界；
 * - 面包屑由空间坐标白名单（W10 接线）回显：/next/resources · 全局资源。
 */
export default function GlobalResourcesPage() {
  return (
    <PermissionGuard
      require={['org:view', 'resource:view', 'portfolio:view']}
      mode="any"
      fallback={
        <div
          data-permission-fallback
          className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
        >
          <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            你没有查看全局资源的权限
          </h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            需要 org:view、resource:view 或 portfolio:view 权限。请联系组织管理员授予权限。
          </p>
        </div>
      }
    >
      <Suspense fallback={<div data-global-resources-loading aria-busy="true" />}>
        <ResourcesHubWithSearchParams />
      </Suspense>
    </PermissionGuard>
  )
}

function ResourcesHubWithSearchParams() {
  const searchParams = useSearchParams()
  const raw = searchParams.get('projectId')
  const parsed = raw ? Number(raw.trim()) : null
  const initialProjectId = parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null
  return <GlobalResourcesHub initialProjectId={initialProjectId} />
}
